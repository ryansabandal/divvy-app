"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { parseBankDetails } from "@/lib/paymentDetails";
import { fetcher } from "@/lib/fetcher";
import { buildParticipantBreakdown } from "@/lib/expenseBreakdown";
import { ExpenseBreakdown } from "@/components/ExpenseBreakdown";

// These interfaces mirror the shapes returned by the two API endpoints this page fetches
interface Participant {
  id: string;
  name: string;
  payment_method_type: "GCASH" | "MAYA" | "BANK_TRANSFER" | null;
  payment_details: string | null;
}

interface ExpenseSplit {
  id: string;
  participant_id: string;
  amount_owed: number;
  units: number | null;
  participant: Participant;
}

interface Expense {
  id: string;
  amount: number;
  description: string;
  split_type: "EVEN" | "CUSTOM" | "QUANTITY";
  quantity: number | null;
  payer: Participant;
  splits: ExpenseSplit[];
}

interface Session {
  id: string;
  name: string;
  participants: Participant[];
  expenses: Expense[];
}

interface Settlement {
  id?: string;
  from_id: string;
  from_name: string;
  to_id: string;
  to_name: string;
  amount: number;
  paid?: boolean;
}

interface SettlementsResponse {
  frozen: boolean;
  stale: boolean;
  settlements: Settlement[];
}

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

  // Tracks which payment-detail row's copy button was just clicked, to show "Copied!" briefly
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  async function handleCopy(text: string, key: string) {
    await navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), 1500);
  }

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

  // Progress numbers: only meaningful once a plan is frozen with paid flags to count
  const paidSettlements = frozen ? settlements.filter((s) => s.paid) : [];
  const paidAmount = paidSettlements.reduce((sum, s) => sum + s.amount, 0);
  const totalAmount = settlements.reduce((sum, s) => sum + s.amount, 0);
  const progressPct = settlements.length > 0 ? (paidSettlements.length / settlements.length) * 100 : 0;

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
              {frozen && (
                // Progress bar shows how much of the plan has been paid, without any controls to change it
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

              {/* Stale-plan warning: no Recalculate here — direct the participant to the organiser */}
              {frozen && stale && (
                <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  Expenses have changed since this plan was finalized — the amounts below may be out of date. Ask the session organiser to recalculate.
                </div>
              )}

              <ul className="flex flex-col gap-3">
                {settlements.map((s) => {
                  const creditor = participantsById.get(s.to_id);
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
                      {creditor?.payment_method_type && creditor?.payment_details ? (
                        (() => {
                          // Bank transfer is stored as "Bank Name - Account Number" — show bank name as
                          // label and copy only the account number, same logic as the settle screen
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
                        })()
                      ) : (
                        <p className="text-xs text-navy/40">
                          {/* Explicit {" "} — JSX strips the space after an expression when the
                              text node wraps onto another line, rendering "Annhasn't" */}
                          {s.to_name}{" "}hasn&apos;t added a payment method yet
                        </p>
                      )}

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
