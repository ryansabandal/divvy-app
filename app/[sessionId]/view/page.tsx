"use client";

import { useParams } from "next/navigation";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import { buildParticipantBreakdown } from "@/lib/expenseBreakdown";
import { ExpenseBreakdown } from "@/components/ExpenseBreakdown";
import { PaymentAction } from "@/components/PaymentAction";
import { SettlementProgress } from "@/components/SettlementProgress";
import { StalePlanBanner } from "@/components/StalePlanBanner";
import type { Session, SettlementsResponse } from "@/lib/types";

// Read-only view for participants: shows the expense breakdown and who owes who.
// No edit forms, no delete buttons, no finalize/recalculate controls.
export default function ViewPage() {
  // Read the [sessionId] segment from the URL (client component, so not a Promise)
  const { sessionId } = useParams<{ sessionId: string }>();

  // Two independent SWR fetches: session data (expenses + participants) + settlement plan
  const { data: session, error: sessionError } = useSWR<Session>(
    sessionId ? `/api/sessions/${sessionId}` : null,
    (url: string) => fetcher(url, "Failed to load session"),
  );
  const { data: settlementsData, error: settlementsError } = useSWR<SettlementsResponse>(
    sessionId ? `/api/sessions/${sessionId}/settlements` : null,
    (url: string) => fetcher(url, "Failed to load session"),
  );

  const error = sessionError ?? settlementsError;
  if (error) {
    return <main className="flex-1 px-4 py-10 text-center text-red-500">{error.message}</main>;
  }
  if (!session || !settlementsData) {
    return <main className="flex-1 px-4 py-10 text-center text-navy/40">Loading…</main>;
  }

  const { frozen, stale, settlements } = settlementsData;
  // Used to look up each creditor's payment method when rendering settlement rows
  const participantsById = new Map(session.participants.map((p) => [p.id, p]));

  return (
    <main className="flex-1 flex flex-col items-center px-4 py-8">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold text-navy mb-1">{session.name}</h1>
        <p className="text-sm text-navy/50 mb-8">{session.participants.length} people</p>

        {/* Expenses — read-only; same card layout as the session page minus the delete button */}
        <section className="mb-8">
          <h2 className="section-label">Expenses</h2>
          {session.expenses.length === 0 ? (
            <p className="text-sm text-navy/40">No expenses yet.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {session.expenses.map((e) => (
                <li key={e.id} className="card-navy p-4">
                  <div className="flex justify-between">
                    <span className="font-semibold text-white">{e.description}</span>
                    <span className="font-semibold text-white">₱{e.amount.toFixed(2)}</span>
                  </div>
                  <p className="mt-1 text-sm text-white/60">
                    Paid by {e.payer.name} ·{" "}
                    {e.split_type === "EVEN"
                      ? "split evenly"
                      : e.split_type === "QUANTITY" && e.quantity
                        ? `${e.quantity} units · ₱${(e.amount / e.quantity).toFixed(2)} each`
                        : "custom split"}
                  </p>
                  {/* Per-person breakdown of who owes what for this expense */}
                  <ul className="mt-2 flex flex-col gap-0.5 text-xs text-white/50">
                    {e.splits.map((s) => (
                      <li key={s.id} className="flex justify-between">
                        <span>
                          {s.participant.name}
                          {s.units != null ? ` ×${s.units}` : ""}
                        </span>
                        <span>₱{s.amount_owed.toFixed(2)}</span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Who pays who — read-only settlement plan; paid rows are styled but not interactive */}
        <section>
          <h2 className="section-label">Who pays who</h2>
          {settlements.length === 0 ? (
            <p className="text-sm text-navy/40">🎉 All settled up — no payments needed.</p>
          ) : (
            <>
              {/* Progress bar shows how much of the plan has been paid, without any controls to change it */}
              <SettlementProgress settlements={settlements} frozen={frozen} />

              {/* Stale-plan warning: no Recalculate here — direct the participant to the organiser */}
              {frozen && stale && (
                <StalePlanBanner>Ask the session organiser to recalculate.</StalePlanBanner>
              )}

              <ul className="flex flex-col gap-3">
                {settlements.map((s) => {
                  const key = s.id ?? `${s.from_id}-${s.to_id}`;
                  return (
                    <li
                      key={key}
                      className={`card flex flex-col gap-2 p-4 ${s.paid ? "border-teal/20 bg-teal/5" : ""}`}
                    >
                      <div className="flex items-center justify-between">
                        <span className={`text-base ${s.paid ? "text-navy/30 line-through" : "text-navy"}`}>
                          <span className="font-semibold">{s.from_name}</span>
                          <span className="text-navy/30"> → </span>
                          <span className="font-semibold">{s.to_name}</span>
                        </span>
                        <span className={`font-semibold ${s.paid ? "text-navy/30 line-through" : "text-navy"}`}>
                          ₱{s.amount.toFixed(2)}
                        </span>
                      </div>

                      {/* Payment detail: copy the number/account and pay inside the relevant app */}
                      <PaymentAction creditor={participantsById.get(s.to_id)} creditorName={s.to_name} />

                      {/* What the debtor is actually being charged for — this is the screen
                          participants open from the shared link, so it's where verifying your
                          own line items matters most */}
                      <ExpenseBreakdown
                        personName={s.from_name}
                        breakdown={buildParticipantBreakdown(s.from_id, session.expenses)}
                        rowAmount={s.amount}
                      />
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
