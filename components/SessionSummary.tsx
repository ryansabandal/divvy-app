import type { Expense } from "@/lib/types";

// Group thousands for the hero numbers only. The rest of the app renders amounts as a plain
// toFixed(2) (e.g. ₱4800.00), which is fine inline in a list — but these tiles exist to be
// glanceable, and ₱6,950.00 is read faster than ₱6950.00. Deliberate local deviation, not drift.
function formatPeso(amount: number) {
  return amount.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// At-a-glance summary tiles above the fold on the session, settle, and read-only view pages.
// Deliberately does NOT show settlement progress: settle and view already render
// <SettlementProgress>, and a progress tile stacked directly above that bar would be the
// same fact twice. Keeping it out also means this component needs no settlement data, so the
// session page (which only fetches GET /api/sessions/:id) can use it without a second request.
export function SessionSummary({
  expenses,
  participantCount,
  payerName,
  onChangePayer,
}: {
  expenses: Expense[];
  participantCount: number;
  // Name of the single session-wide payer (see lib/sessionPayer.ts's deriveSessionPayer) — null
  // for a mixed-payer session. When set, replaces the "Avg / person" tile: once total and people
  // count are already two tiles, "who do I pay" is more actionable than the per-person average.
  payerName?: string | null;
  // Session (edit) page only: re-opens its session-payer picker, which otherwise collapses
  // entirely once locked. Omitted by view/settle, which have no picker to reopen — so no
  // "Change" link renders there even if payerName is set.
  onChangePayer?: () => void;
}) {
  // "Total bill" is the sum of what was actually PAID (expense.amount), not the sum of
  // ExpenseSplit.amount_owed. The two are not guaranteed equal: the CUSTOM-split guard only
  // enforces agreement to within RECONCILED_EPSILON (half a centavo) per expense, so across a
  // session those sums can drift by cents. expense.amount is the figure a human can check
  // against an actual receipt, so it's the honest one to put on screen.
  const totalBill = expenses.reduce((sum, e) => sum + e.amount, 0);

  // Derived from the total, not averaged from splits — averaging splits would compound the
  // same per-expense drift described above. Guard against a session with no participants.
  const perPerson = participantCount > 0 ? totalBill / participantCount : 0;

  return (
    <div className="bento-grid mb-8">
      {/* Labelled "Total bill", not "Total spent". On the settle page this tile sits directly
          above <SettlementProgress>, whose "₱X of ₱Y" is a smaller, legitimately different
          number — what still has to change hands after netting people off against each other.
          Two unexplained peso figures stacked in a money app read as a contradiction, so both
          labels name what they measure: the whole bill here, transfers there. */}
      <div className="bento-tile bento-tile-dark bento-tile-wide">
        <span className="bento-value">₱{formatPeso(totalBill)}</span>
        <span className="bento-label">Total bill</span>
      </div>

      <div className="bento-tile bento-tile-accent">
        <span className="bento-value">{participantCount}</span>
        <span className="bento-label">{participantCount === 1 ? "Person" : "People"}</span>
      </div>

      {payerName ? (
        <div className="bento-tile">
          <span className="bento-value truncate">{payerName}</span>
          <span className="bento-label">Paid by</span>
          {onChangePayer && (
            <button
              type="button"
              onClick={onChangePayer}
              className="text-btn self-start text-left text-xs font-medium text-teal underline"
            >
              Change
            </button>
          )}
        </div>
      ) : (
        <div className="bento-tile">
          <span className="bento-value">₱{formatPeso(perPerson)}</span>
          <span className="bento-label">Avg / person</span>
        </div>
      )}
    </div>
  );
}
