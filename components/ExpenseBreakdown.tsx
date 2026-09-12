"use client";

import { useId, useState } from "react";
import type { ParticipantBreakdown } from "@/lib/expenseBreakdown";
import { RECONCILED_EPSILON } from "@/lib/settle";

// Collapsible "what is this person actually being charged for" panel, rendered under a settlement
// row on both the settle screen and the read-only view. Shared rather than copy-pasted between the
// two pages so the two never drift apart.
export function ExpenseBreakdown({
  personName,
  breakdown,
  rowAmount,
  hidePayerName = false,
}: {
  personName: string;
  breakdown: ParticipantBreakdown;
  rowAmount: number;
  // True once every expense in the session shares one payer (see lib/sessionPayer.ts) — that
  // payer is already named once elsewhere on the page, so repeating "· X paid" on every charge
  // line would be pure noise. Defaults to false (today's behaviour) so a caller that doesn't pass
  // it — and a mixed-payer session, where a charge's payer can genuinely vary line to line — is
  // unaffected.
  hidePayerName?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId(); // ties the toggle to its panel for screen readers

  // totalPaid isn't destructured — each payment is listed individually below, which reads better
  // than one lump sum when someone fronted more than one expense
  const { charges, payments, totalCharged, netOwed } = breakdown;

  // Nothing useful to show if this person has no line items at all
  if (charges.length === 0 && payments.length === 0) return null;

  // The settlement plan is a simplified routing of net balances, so one payment doesn't always
  // cover a person's whole net — when it doesn't, say so rather than letting the numbers look wrong
  const coversWholeNet = Math.abs(netOwed - rowAmount) <= RECONCILED_EPSILON;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="text-xs font-medium text-teal"
      >
        {open ? "Hide breakdown" : "View breakdown"}
      </button>

      {open && (
        <div id={panelId} className="panel-reveal mt-2 rounded-xl bg-beige px-3 py-2 text-xs">
          <p className="mb-1.5 font-medium text-navy/50">{personName}&apos;s charges</p>

          <ul className="flex flex-col gap-1">
            {charges.map((c) => (
              <li key={c.expenseId} className="flex justify-between gap-2">
                <span className="text-navy/70">
                  {c.description}
                  {c.units != null ? ` ×${c.units}` : ""}
                  {!hidePayerName && <span className="text-navy/40"> · {c.payerName} paid</span>}
                </span>
                <span className="shrink-0 text-navy">₱{c.amountOwed.toFixed(2)}</span>
              </li>
            ))}
          </ul>

          {/* Only worth showing the arithmetic when this person also fronted an expense —
              otherwise the charges above already add up to what they owe */}
          {payments.length > 0 && (
            <>
              <div className="mt-1.5 flex justify-between border-t border-navy/10 pt-1.5 text-navy/50">
                <span>Total charged</span>
                <span>₱{totalCharged.toFixed(2)}</span>
              </div>
              {payments.map((p) => (
                <div key={p.expenseId} className="flex justify-between gap-2 text-navy/50">
                  <span>
                    Less {p.description}
                    <span className="text-navy/40"> · they paid</span>
                  </span>
                  <span className="shrink-0">−₱{p.amount.toFixed(2)}</span>
                </div>
              ))}
            </>
          )}

          <div className="mt-1.5 flex justify-between border-t border-navy/10 pt-1.5 font-medium text-navy">
            <span>Net owed</span>
            <span>₱{netOwed.toFixed(2)}</span>
          </div>

          {!coversWholeNet && (
            <p className="mt-1.5 text-navy/40">
              This payment covers ₱{rowAmount.toFixed(2)} of it — the rest is settled in another row.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
