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

  return (
    <div className="mb-6">
      <div
        role="progressbar"
        aria-label="Settlement progress"
        aria-valuenow={paidSettlements.length}
        aria-valuemin={0}
        aria-valuemax={settlements.length}
        aria-valuetext={`${paidSettlements.length} of ${settlements.length} paid, ₱${paidAmount.toFixed(2)} of ₱${totalAmount.toFixed(2)}`}
        className="h-2 w-full rounded-full bg-navy/10"
      >
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
  );
}
