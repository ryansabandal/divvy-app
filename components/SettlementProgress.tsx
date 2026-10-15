import type { Settlement } from "@/lib/types";

// Progress bar: how much of a frozen settlement plan has actually been paid back. Shared between
// the settle and view pages so the two never drift apart.
export function SettlementProgress({
  settlements,
  frozen,
}: {
  settlements: Settlement[];
  frozen: boolean;
}) {
  // Progress numbers only mean anything once a plan is frozen and has paid flags to count
  if (!frozen) return null;

  const paidSettlements = settlements.filter((s) => s.paid);
  const paidAmount = paidSettlements.reduce((sum, s) => sum + s.amount, 0);
  const totalAmount = settlements.reduce((sum, s) => sum + s.amount, 0);
  const progressPct = settlements.length > 0 ? (paidSettlements.length / settlements.length) * 100 : 0;
  // True only when a non-empty plan is fully paid
  const isComplete = settlements.length > 0 && paidSettlements.length === settlements.length;

  return (
    <div className="mb-6">
      {/* aria-valuetext is kept word-for-word in sync with the visible <p> below — screen-reader
          equivalence is the whole point of this attribute (backlog ticket 11), so the two strings
          change together or not at all. */}
      <div
        role="progressbar"
        aria-label="Settlement progress"
        aria-valuenow={paidSettlements.length}
        aria-valuemin={0}
        aria-valuemax={settlements.length}
        aria-valuetext={`${paidSettlements.length} of ${settlements.length} payments settled, ₱${paidAmount.toFixed(2)} of ₱${totalAmount.toFixed(2)} transferred`}
        className="h-2 w-full rounded-full bg-navy/10"
      >
        <div
          className="h-2 rounded-full bg-teal progress-fill"
          style={{ width: `${progressPct}%` }}
        />
      </div>
      {/* "payments settled" / "transferred" rather than a bare "paid" — this line sits directly
          under the summary's "Total bill" tile, and ₱X-of-₱Y here is money that changes hands
          after netting, always ≤ the bill. Naming both keeps them from reading as a discrepancy. */}
      <p className="mt-1.5 text-xs tabular-nums text-navy/50">
        {paidSettlements.length} of {settlements.length} payments settled · ₱
        {paidAmount.toFixed(2)} of ₱{totalAmount.toFixed(2)} transferred
      </p>
      {/* Its own conditionally-mounted element, not a class toggled on the caption above —
          @starting-style only fires on mount */}
      {isComplete && (
        <p className="enter-pop mt-1.5 text-xs font-medium text-teal">
          🎉 Everyone&apos;s settled up
        </p>
      )}
    </div>
  );
}
