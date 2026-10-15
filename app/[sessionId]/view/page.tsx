"use client";

import type { CSSProperties } from "react";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import { deriveSessionPayer } from "@/lib/sessionPayer";
import { buildParticipantBreakdown } from "@/lib/expenseBreakdown";
import { ExpenseBreakdown } from "@/components/ExpenseBreakdown";
import { ExpenseRow } from "@/components/ExpenseRow";
import { PaymentAction } from "@/components/PaymentAction";
import { SessionSummary } from "@/components/SessionSummary";
import { SessionPayerNote } from "@/components/SessionPayerNote";
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
  // Non-null only when every expense shares one payer — see lib/sessionPayer.ts. Drives whether
  // the payer is stated once under the heading or repeated per row, on this page and below in
  // the settlement breakdown, matching what the session (edit) page shows.
  const derivedSessionPayer = deriveSessionPayer(session.expenses);

  return (
    <main className="flex-1 flex flex-col items-center px-4 py-8">
      <div className="w-full max-w-sm">
        <h1 className="heading-title text-3xl text-balance text-navy mb-4">{session.name}</h1>

        {/* Stale-plan warning shown above the summary tiles, not just above the progress bar:
            once expenses change post-finalize, SessionSummary's live "Total bill" and
            SettlementProgress's frozen "transferred" total can disagree (even invert), so the
            reader needs this context before either number, not after. */}
        {frozen && stale && (
          <StalePlanBanner>Ask the session organiser to recalculate.</StalePlanBanner>
        )}

        <SessionSummary
          expenses={session.expenses}
          participantCount={session.participants.length}
          payerName={derivedSessionPayer?.name}
        />

        {/* Expenses — read-only; same card layout as the session page minus the delete button */}
        <section className="mb-8">
          <h2 className="section-label">Expenses</h2>
          {/* Named once here instead of on every card below — only true once every expense
              shares one payer; a mixed session falls back to naming the payer per row */}
          <SessionPayerNote payer={derivedSessionPayer} className="-mt-2 mb-3 text-sm text-navy/40" />
          {session.expenses.length === 0 ? (
            <p className="text-sm text-navy/40">No expenses yet.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {session.expenses.map((e) => (
                <li key={e.id} className="card-navy p-4">
                  <ExpenseRow expense={e} hidePayerName={!!derivedSessionPayer} />
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

              <ul className="flex flex-col gap-3">
                {settlements.map((s, index) => {
                  const key = s.id ?? `${s.from_id}-${s.to_id}`;
                  return (
                    <li
                      key={key}
                      className={`card settlement-row flex flex-col gap-2 p-4 ${s.paid ? "settlement-row-paid" : ""}`}
                      style={{ "--i": index } as CSSProperties}
                    >
                      <div className="flex items-center justify-between">
                        <span className={`settlement-text text-base ${s.paid ? "text-navy/30 line-through" : "text-navy"}`}>
                          <span className="font-semibold">{s.from_name}</span>
                          <span className="text-navy/30"> → </span>
                          <span className="font-semibold">{s.to_name}</span>
                        </span>
                        <span className={`settlement-text font-semibold tabular-nums ${s.paid ? "text-navy/30 line-through" : "text-navy"}`}>
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
                        hidePayerName={!!derivedSessionPayer}
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
