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
}: {
  expenses: Expense[];
  participantCount: number;
}) {
  // "Total spent" is the sum of what was actually PAID (expense.amount), not the sum of
  // ExpenseSplit.amount_owed. The two are not guaranteed equal: the CUSTOM-split guard only
  // enforces agreement to within RECONCILED_EPSILON (half a centavo) per expense, so across a
  // session those sums can drift by cents. expense.amount is the figure a human can check
  // against an actual receipt, so it's the honest one to put on screen.
  const totalSpent = expenses.reduce((sum, e) => sum + e.amount, 0);

  // Derived from the total, not averaged from splits — averaging splits would compound the
  // same per-expense drift described above. Guard against a session with no participants.
  const perPerson = participantCount > 0 ? totalSpent / participantCount : 0;

  return (
    <div className="bento-grid mb-8">
      <div className="bento-tile bento-tile-dark bento-tile-wide">
        <span className="bento-value">₱{formatPeso(totalSpent)}</span>
        <span className="bento-label">Total spent</span>
      </div>

      <div className="bento-tile bento-tile-cream">
        <span className="bento-value">{participantCount}</span>
        <span className="bento-label">{participantCount === 1 ? "Person" : "People"}</span>
      </div>

      <div className="bento-tile">
        <span className="bento-value">₱{formatPeso(perPerson)}</span>
        <span className="bento-label">Avg / person</span>
      </div>
    </div>
  );
}
