"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import useSWR from "swr";

// One payment in the settlement plan. id/paid are only present once the plan is frozen —
// a live preview (computed fresh, not yet persisted) omits both.
interface Settlement {
  id?: string;
  from_id: string;
  from_name: string;
  to_id: string;
  to_name: string;
  amount: number;
  paid?: boolean;
}

// The endpoint wraps the list with a flag for whether it's a frozen plan or a live preview
interface SettlementsResponse {
  frozen: boolean;
  settlements: Settlement[];
}

// Just enough of GET /api/sessions/:sessionId to look up a creditor's payment method
interface Participant {
  id: string;
  name: string;
  payment_method_type: "GCASH" | "MAYA" | "BANK_TRANSFER" | null;
  payment_details: string | null;
}

interface Session {
  participants: Participant[];
}

// GCash/Maya deep links per CLAUDE.md's Payment Links spec; bank transfer has no equivalent
const gcashLink = (number: string, amount: number) => `https://gcash.me/${encodeURIComponent(number)}/${amount.toFixed(2)}`;
const mayaLink = (number: string, amount: number) =>
  `https://maya.ph/pay/${encodeURIComponent(number)}?amount=${amount.toFixed(2)}`;

// SWR calls this with the URL key; returns parsed JSON or throws on a bad response
const fetcher = (url: string) =>
  fetch(url).then((res) => {
    if (!res.ok) {
      throw new Error(res.status === 404 ? "Session not found" : "Failed to load settlements");
    }
    return res.json();
  });

// Settlement screen: live preview until finalized, then a trackable plan with paid checkboxes
export default function SettlePage() {
  // Read the [sessionId] segment straight off the URL (client component, so it's not a Promise here)
  const { sessionId } = useParams<{ sessionId: string }>();

  // SWR owns the fetch + cache + re-render; the key is null until sessionId is known so it won't fire early
  const { data, error, mutate } = useSWR<SettlementsResponse>(
    sessionId ? `${process.env.NEXT_PUBLIC_API_URL}/api/sessions/${sessionId}/settlements` : null,
    fetcher,
  );

  // Second, independent fetch for payment methods — shares SWR's cache with the session page,
  // so this is often instant if the user arrived via the "Settle up" link
  const { data: session } = useSWR<Session>(
    sessionId ? `${process.env.NEXT_PUBLIC_API_URL}/api/sessions/${sessionId}` : null,
    fetcher,
  );

  // Tracks which settlement row's bank details were just copied, to show "Copied!" briefly
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  async function handleCopy(text: string, key: string) {
    await navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), 1500);
  }

  if (error) {
    return <main className="flex-1 px-4 py-10 text-center text-red-600">{error.message}</main>;
  }
  if (!data) {
    return <main className="flex-1 px-4 py-10 text-center text-gray-500">Loading…</main>;
  }

  const { frozen, settlements } = data;
  const participantsById = new Map((session?.participants ?? []).map((p) => [p.id, p]));

  // Render how the debtor should pay the creditor for one row, based on the creditor's saved method
  function renderPaymentAction(s: Settlement) {
    const creditor = participantsById.get(s.to_id);
    if (!creditor || !creditor.payment_method_type || !creditor.payment_details) {
      return <p className="text-xs text-gray-400">{s.to_name} hasn&apos;t added a payment method yet</p>;
    }

    if (creditor.payment_method_type === "GCASH") {
      return (
        <a
          href={gcashLink(creditor.payment_details, s.amount)}
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full rounded-md border border-black py-2 text-center text-sm font-medium"
        >
          Pay via GCash
        </a>
      );
    }

    if (creditor.payment_method_type === "MAYA") {
      return (
        <a
          href={mayaLink(creditor.payment_details, s.amount)}
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full rounded-md border border-black py-2 text-center text-sm font-medium"
        >
          Pay via Maya
        </a>
      );
    }

    // BANK_TRANSFER has no deep link (per CLAUDE.md) — just the detail string, with a copy button
    const key = s.id ?? `${s.from_id}-${s.to_id}`;
    return (
      <div className="flex items-center justify-between gap-2 rounded-md bg-gray-50 px-3 py-2">
        <span className="text-sm">{creditor.payment_details}</span>
        <button
          type="button"
          onClick={() => handleCopy(creditor.payment_details!, key)}
          className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium"
        >
          {copiedKey === key ? "Copied!" : "Copy"}
        </button>
      </div>
    );
  }

  // Freeze the live preview into trackable rows. Expenses stay editable afterward — Recalculate
  // (below) is how later edits get folded back in, at the cost of resetting paid progress.
  async function handleFinalize() {
    const confirmed = window.confirm(
      "Finalize this plan so you can check off payments as they happen?\n\n" +
        "You can still add or remove expenses afterward — just hit Recalculate to update the plan, which resets any payments you've already checked off.",
    );
    if (!confirmed) return;
    await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/sessions/${sessionId}/settlements`, { method: "POST" });
    await mutate();
  }

  // Same endpoint as Finalize, but here we warn explicitly that it wipes checked-off payments
  async function handleRecalculate() {
    const confirmed = window.confirm(
      "Recalculating replaces the current plan with one based on today's expenses, and resets every payment back to unpaid. Continue?",
    );
    if (!confirmed) return;
    await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/sessions/${sessionId}/settlements`, { method: "POST" });
    await mutate();
  }

  // Flip one payment's paid state, then refetch so the progress bar and styling stay in sync
  async function handleTogglePaid(settlementId: string, currentlyPaid: boolean) {
    await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/sessions/${sessionId}/settlements/${settlementId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paid: !currentlyPaid }),
    });
    await mutate();
  }

  // Progress numbers only mean anything once a plan is frozen and has paid flags to count
  const paidSettlements = frozen ? settlements.filter((s) => s.paid) : [];
  const paidAmount = paidSettlements.reduce((sum, s) => sum + s.amount, 0);
  const totalAmount = settlements.reduce((sum, s) => sum + s.amount, 0);
  const progressPct = settlements.length > 0 ? (paidSettlements.length / settlements.length) * 100 : 0;

  return (
    <main className="flex-1 flex flex-col items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold mb-1">Settle up</h1>
        <p className="text-sm text-gray-500 mb-6">
          {frozen ? "Track who's paid back" : "Who owes who, with the fewest payments"}
        </p>

        {settlements.length === 0 ? (
          // Either nobody owes anything, or a frozen plan with zero rows looks identical to a
          // preview with zero rows — either way there's nothing to track, so no button below
          <p className="text-sm text-gray-400">🎉 All settled up — no payments needed.</p>
        ) : (
          <>
            {frozen && (
              // Progress bar: how much of the frozen plan has actually been paid back
              <div className="mb-4">
                <div className="h-2 w-full rounded-full bg-gray-100">
                  <div
                    className="h-2 rounded-full bg-green-500 transition-all"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  {paidSettlements.length} of {settlements.length} paid · ₱{paidAmount.toFixed(2)} of ₱
                  {totalAmount.toFixed(2)}
                </p>
              </div>
            )}

            <ul className="flex flex-col gap-3">
              {settlements.map((s) => (
                <li
                  key={s.id ?? `${s.from_id}-${s.to_id}`}
                  className={`flex flex-col gap-2 rounded-md border p-3 ${
                    s.paid ? "border-green-200 bg-green-50" : "border-gray-200"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-3">
                      {/* The checkbox only makes sense once this row is a real, persisted payment */}
                      {frozen && s.id && (
                        <input
                          type="checkbox"
                          checked={!!s.paid}
                          onChange={() => handleTogglePaid(s.id!, !!s.paid)}
                        />
                      )}
                      <span className={`text-base ${s.paid ? "text-gray-400 line-through" : ""}`}>
                        <span className="font-medium">{s.from_name}</span>
                        <span className="text-gray-400"> → </span>
                        <span className="font-medium">{s.to_name}</span>
                      </span>
                    </label>
                    <span className={`font-medium ${s.paid ? "text-gray-400 line-through" : ""}`}>
                      ₱{s.amount.toFixed(2)}
                    </span>
                  </div>

                  {/* How the debtor should actually pay the creditor */}
                  {renderPaymentAction(s)}
                </li>
              ))}
            </ul>

            <button
              type="button"
              onClick={frozen ? handleRecalculate : handleFinalize}
              className="mt-6 w-full rounded-md bg-black text-white py-3 text-base font-medium"
            >
              {frozen ? "Recalculate" : "Finalize Expenses"}
            </button>
          </>
        )}

        {/* Back to the session view to keep editing expenses */}
        <Link href={`/${sessionId}`} className="mt-4 block text-center text-sm text-gray-500 underline">
          ← Back to expenses
        </Link>
      </div>
    </main>
  );
}
