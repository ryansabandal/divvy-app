"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import { buildParticipantBreakdown } from "@/lib/expenseBreakdown";
import { ExpenseBreakdown } from "@/components/ExpenseBreakdown";
import { PaymentAction } from "@/components/PaymentAction";
import { SettlementProgress } from "@/components/SettlementProgress";
import { StalePlanBanner } from "@/components/StalePlanBanner";
import type { Session, SettlementsResponse } from "@/lib/types";

// Settlement screen: live preview until finalized, then a trackable plan with paid checkboxes
export default function SettlePage() {
  // Read the [sessionId] segment straight off the URL (client component, so it's not a Promise here)
  const { sessionId } = useParams<{ sessionId: string }>();

  // SWR owns the fetch + cache + re-render; the key is null until sessionId is known so it won't fire early
  const { data, error, mutate } = useSWR<SettlementsResponse>(
    sessionId ? `/api/sessions/${sessionId}/settlements` : null,
    (url: string) => fetcher(url, "Failed to load settlements"),
  );

  // Second, independent fetch for payment methods — shares SWR's cache with the session page,
  // so this is often instant if the user arrived via the "Settle up" link
  const { data: session } = useSWR<Session>(
    sessionId ? `/api/sessions/${sessionId}` : null,
    (url: string) => fetcher(url, "Failed to load settlements"),
  );

  // Holds an error message from Finalize / Recalculate / Toggle-paid if the server returns non-2xx
  const [actionError, setActionError] = useState<string | null>(null);

  if (error) {
    return <main className="flex-1 px-4 py-10 text-center text-red-500">{error.message}</main>;
  }
  if (!data) {
    return <main className="flex-1 px-4 py-10 text-center text-navy/40">Loading…</main>;
  }

  const { frozen, stale, settlements } = data;
  const participantsById = new Map((session?.participants ?? []).map((p) => [p.id, p]));

  // Freeze the live preview into trackable rows. Expenses stay editable afterward — Recalculate
  // (below) is how later edits get folded back in, at the cost of resetting paid progress.
  async function handleFinalize() {
    const confirmed = window.confirm(
      "Finalize this plan so you can check off payments as they happen?\n\n" +
        "You can still add or remove expenses afterward — just hit Recalculate to update the plan, which resets any payments you've already checked off.",
    );
    if (!confirmed) return;
    setActionError(null);
    const res = await fetch(`/api/sessions/${sessionId}/settlements`, { method: "POST" });
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
    const res = await fetch(`/api/sessions/${sessionId}/settlements`, { method: "POST" });
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
    const res = await fetch(`/api/sessions/${sessionId}/settlements/${settlementId}`, {
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
            {/* Progress bar: how much of the frozen plan has actually been paid back */}
            <SettlementProgress settlements={settlements} frozen={frozen} />

            {/* Stale-plan warning: shown when expenses changed after the plan was finalized */}
            {frozen && stale && (
              <StalePlanBanner>
                Hit <strong>Recalculate</strong> to update.
              </StalePlanBanner>
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
                  <PaymentAction creditor={participantsById.get(s.to_id)} creditorName={s.to_name} />

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
