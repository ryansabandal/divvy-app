"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { parseBankDetails } from "@/lib/paymentDetails";
import { apiUrl } from "@/lib/apiUrl";
import { fetcher } from "@/lib/fetcher";
import { buildParticipantBreakdown, type BreakdownExpense } from "@/lib/expenseBreakdown";
import { ExpenseBreakdown } from "@/components/ExpenseBreakdown";

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

// The endpoint wraps the list with a flag for whether it's a frozen plan or a live preview,
// and a stale flag for when expenses changed after the plan was finalized
interface SettlementsResponse {
  frozen: boolean;
  stale: boolean;
  settlements: Settlement[];
}

// Just enough of GET /api/sessions/:sessionId to look up a creditor's payment method and to
// break down what each debtor is being charged for
interface Participant {
  id: string;
  name: string;
  payment_method_type: "GCASH" | "MAYA" | "BANK_TRANSFER" | null;
  payment_details: string | null;
}

interface Session {
  participants: Participant[];
  // Typed via the breakdown module's own minimal shape rather than redeclaring the full Expense
  // interface a fourth time across the app
  expenses: BreakdownExpense[];
}

// Settlement screen: live preview until finalized, then a trackable plan with paid checkboxes
export default function SettlePage() {
  // Read the [sessionId] segment straight off the URL (client component, so it's not a Promise here)
  const { sessionId } = useParams<{ sessionId: string }>();

  // SWR owns the fetch + cache + re-render; the key is null until sessionId is known so it won't fire early
  const { data, error, mutate } = useSWR<SettlementsResponse>(
    sessionId ? apiUrl(`/api/sessions/${sessionId}/settlements`) : null,
    (url: string) => fetcher(url, "Failed to load settlements"),
  );

  // Second, independent fetch for payment methods — shares SWR's cache with the session page,
  // so this is often instant if the user arrived via the "Settle up" link
  const { data: session } = useSWR<Session>(
    sessionId ? apiUrl(`/api/sessions/${sessionId}`) : null,
    (url: string) => fetcher(url, "Failed to load settlements"),
  );

  // Tracks which settlement row's bank details were just copied, to show "Copied!" briefly
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  // Holds an error message from Finalize / Recalculate / Toggle-paid if the server returns non-2xx
  const [actionError, setActionError] = useState<string | null>(null);

  async function handleCopy(text: string, key: string) {
    await navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), 1500);
  }

  if (error) {
    return <main className="flex-1 px-4 py-10 text-center text-red-500">{error.message}</main>;
  }
  if (!data) {
    return <main className="flex-1 px-4 py-10 text-center text-navy/40">Loading…</main>;
  }

  const { frozen, stale, settlements } = data;
  const participantsById = new Map((session?.participants ?? []).map((p) => [p.id, p]));

  // Render how the debtor should pay the creditor for one row, based on the creditor's saved method.
  // None of GCash/Maya/Bank offer a working public deep link, so all three show the detail + a Copy
  // button — the payer copies the number/account and pays inside the relevant app themselves.
  function renderPaymentAction(s: Settlement) {
    const creditor = participantsById.get(s.to_id);
    if (!creditor || !creditor.payment_method_type || !creditor.payment_details) {
      return <p className="text-xs text-navy/40">{s.to_name} hasn&apos;t added a payment method yet</p>;
    }

    // Bank transfer is stored as "Bank Name - Account Number" — show bank name as label,
    // display and copy only the account number so the payer doesn't accidentally include the bank name
    let methodLabel: string;
    let displayText: string;
    let copyText: string;
    if (creditor.payment_method_type === "BANK_TRANSFER") {
      const { bankName, accountNumber } = parseBankDetails(creditor.payment_details);
      methodLabel = bankName || "Bank";
      displayText = accountNumber;
      copyText = accountNumber;
    } else {
      methodLabel = creditor.payment_method_type === "GCASH" ? "GCash" : "Maya";
      displayText = creditor.payment_details;
      copyText = creditor.payment_details;
    }

    const key = s.id ?? `${s.from_id}-${s.to_id}`;
    return (
      <div className="flex items-center justify-between gap-2 rounded-xl bg-beige px-3 py-2">
        <span className="text-sm text-navy">
          <span className="text-navy/40">{methodLabel} · </span>
          {displayText}
        </span>
        <button
          type="button"
          onClick={() => handleCopy(copyText, key)}
          className="btn-compact shrink-0"
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
    setActionError(null);
    const res = await fetch(apiUrl(`/api/sessions/${sessionId}/settlements`), { method: "POST" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setActionError(body.error ?? "Failed to finalize plan");
      return;
    }
    await mutate();
  }

  // Same endpoint as Finalize, but here we warn explicitly that it wipes checked-off payments
  async function handleRecalculate() {
    const confirmed = window.confirm(
      "Recalculating replaces the current plan with one based on today's expenses, and resets every payment back to unpaid. Continue?",
    );
    if (!confirmed) return;
    setActionError(null);
    const res = await fetch(apiUrl(`/api/sessions/${sessionId}/settlements`), { method: "POST" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setActionError(body.error ?? "Failed to recalculate plan");
      return;
    }
    await mutate();
  }

  // Flip one payment's paid state, then refetch so the progress bar and styling stay in sync
  async function handleTogglePaid(settlementId: string, currentlyPaid: boolean) {
    setActionError(null);
    const res = await fetch(apiUrl(`/api/sessions/${sessionId}/settlements/${settlementId}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paid: !currentlyPaid }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setActionError(body.error ?? "Failed to update payment");
      return;
    }
    await mutate();
  }

  // Progress numbers only mean anything once a plan is frozen and has paid flags to count
  const paidSettlements = frozen ? settlements.filter((s) => s.paid) : [];
  const paidAmount = paidSettlements.reduce((sum, s) => sum + s.amount, 0);
  const totalAmount = settlements.reduce((sum, s) => sum + s.amount, 0);
  const progressPct = settlements.length > 0 ? (paidSettlements.length / settlements.length) * 100 : 0;

  return (
    <main className="flex-1 flex flex-col items-center px-4 py-8">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold text-navy mb-1">Settle up</h1>
        <p className="text-sm text-navy/50 mb-8">
          {frozen ? "Track who's paid back" : "Who owes who, with the fewest payments"}
        </p>

        {settlements.length === 0 ? (
          // Either nobody owes anything, or a frozen plan with zero rows looks identical to a
          // preview with zero rows — either way there's nothing to track, so no button below
          <p className="text-sm text-navy/40">🎉 All settled up — no payments needed.</p>
        ) : (
          <>
            {frozen && (
              // Progress bar: how much of the frozen plan has actually been paid back
              <div className="mb-6">
                <div className="h-2 w-full rounded-full bg-navy/10">
                  <div
                    className="h-2 rounded-full bg-teal transition-all"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <p className="mt-1.5 text-xs text-navy/50">
                  {paidSettlements.length} of {settlements.length} paid · ₱{paidAmount.toFixed(2)} of ₱
                  {totalAmount.toFixed(2)}
                </p>
              </div>
            )}

            {/* Stale-plan warning: shown when expenses changed after the plan was finalized */}
            {frozen && stale && (
              <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                Expenses have changed since this plan was finalized — the amounts below may be out of date. Hit <strong>Recalculate</strong> to update.
              </div>
            )}

            <ul className="flex flex-col gap-3">
              {settlements.map((s) => (
                <li
                  key={s.id ?? `${s.from_id}-${s.to_id}`}
                  className={`card flex flex-col gap-2 p-4 ${s.paid ? "border-teal/20 bg-teal/5" : ""}`}
                >
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-3">
                      {/* The checkbox only makes sense once this row is a real, persisted payment */}
                      {frozen && s.id && (
                        <input
                          type="checkbox"
                          checked={!!s.paid}
                          onChange={() => handleTogglePaid(s.id!, !!s.paid)}
                          className="accent-teal"
                        />
                      )}
                      <span className={`text-base ${s.paid ? "text-navy/30 line-through" : "text-navy"}`}>
                        <span className="font-semibold">{s.from_name}</span>
                        <span className="text-navy/30"> → </span>
                        <span className="font-semibold">{s.to_name}</span>
                      </span>
                    </label>
                    <span className={`font-semibold ${s.paid ? "text-navy/30 line-through" : "text-navy"}`}>
                      ₱{s.amount.toFixed(2)}
                    </span>
                  </div>

                  {/* How the debtor should actually pay the creditor */}
                  {renderPaymentAction(s)}

                  {/* What the debtor is actually being charged for, so they can verify their own
                      line items without scrolling the whole expense list back on the session page */}
                  {session && (
                    <ExpenseBreakdown
                      personName={s.from_name}
                      breakdown={buildParticipantBreakdown(s.from_id, session.expenses)}
                      rowAmount={s.amount}
                    />
                  )}
                </li>
              ))}
            </ul>

            {actionError && <p className="mt-4 text-sm text-red-500">{actionError}</p>}
            <button
              type="button"
              onClick={frozen ? handleRecalculate : handleFinalize}
              className={frozen ? "btn-secondary mt-6" : "btn-primary mt-6"}
            >
              {frozen ? "Recalculate" : "Finalize Expenses"}
            </button>
          </>
        )}

        {/* Back to the session view to keep editing expenses */}
        <Link href={`/${sessionId}`} className="mt-4 block text-center text-sm text-navy/40 underline">
          ← Back to expenses
        </Link>
      </div>
    </main>
  );
}
