import type { ReactNode } from "react";
import type { Expense } from "@/lib/types";

// One expense's contents: description/amount header, the split-type summary line, and the
// per-person breakdown. Shared by the session page (inside SortableExpenseCard, which adds drag
// wiring and edit/delete buttons via the leading/actions slots) and the read-only view page
// (which renders it plain, with both slots omitted). Each caller keeps its own <li>/wrapper; this
// component only owns what's inside it.
export function ExpenseRow({
  expense,
  hidePayerName,
  leading,
  actions,
}: {
  expense: Expense;
  // True once every expense in the session shares one payer — that payer is already named once
  // under the section heading, so repeating it on every row would be pure noise. See the
  // "Paid by" guard just below: any expense whose payer differs still gets it stated per row.
  hidePayerName: boolean;
  // Session page only: the drag handle, rendered before the description. Omitted on the
  // read-only view page, which has no reordering.
  leading?: ReactNode;
  // Session page only: edit/delete buttons, rendered after the amount. Omitted on the read-only
  // view page, which has no mutation controls.
  actions?: ReactNode;
}) {
  // Only make room for a leading/trailing slot when the caller actually passed one — an empty
  // wrapper still applies shrink-0/margin classes that shift where a long description wraps, so
  // the read-only view page (which passes neither) renders the same plain two-span header it
  // always has, not a version with unused spacing rules baked in.
  const hasSlots = Boolean(leading || actions);
  return (
    <>
      <div className={hasSlots ? "flex items-start justify-between" : "flex justify-between"}>
        {leading ? (
          <div className="flex items-center gap-2">
            {leading}
            <span className="font-semibold text-white">{expense.description}</span>
          </div>
        ) : (
          <span className="font-semibold text-white">{expense.description}</span>
        )}
        {actions ? (
          <div className="ml-2 flex shrink-0 items-center gap-2">
            <span className="font-semibold text-white">₱{expense.amount.toFixed(2)}</span>
            {actions}
          </div>
        ) : (
          <span className="font-semibold text-white">₱{expense.amount.toFixed(2)}</span>
        )}
      </div>
      <p className="mt-1 text-sm text-white/60">
        {!hidePayerName && <>Paid by {expense.payer.name} · </>}
        {expense.split_type === "EVEN"
          ? "split evenly"
          : expense.split_type === "QUANTITY" && expense.quantity
            ? `${expense.quantity} units · ₱${(expense.amount / expense.quantity).toFixed(2)} each`
            : "custom split"}
      </p>
      {/* Per-person breakdown of who owes what for this one expense */}
      <ul className="mt-2 flex flex-col gap-0.5 text-xs text-white/50">
        {expense.splits.map((s) => (
          <li key={s.id} className="flex justify-between">
            <span>
              {s.participant.name}
              {s.units != null ? ` ×${s.units}` : ""}
            </span>
            <span>₱{s.amount_owed.toFixed(2)}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
