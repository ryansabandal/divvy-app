"use client";

import { useState } from "react";
import { RECONCILED_EPSILON } from "@/lib/settle";
import type { Expense, Participant } from "@/lib/types";

// What an editingExpense should seed each field to; blank/default values in add mode
function seedFromExpense(editingExpense: Expense | null) {
  return {
    description: editingExpense?.description ?? "",
    amount: editingExpense ? String(editingExpense.amount) : "",
    // Always PIN the override to this expense's actual payer for the duration of the edit —
    // never null, even when it currently matches the session-wide payer. Leaving it null would
    // let a live session-payer shift silently retarget this expense's paid_by on Save.
    payerOverride: editingExpense ? editingExpense.payer.id : null,
    splitType: editingExpense?.split_type ?? ("EVEN" as const),
    splitWith:
      editingExpense?.split_type === "EVEN" ? editingExpense.splits.map((s) => s.participant_id) : null,
    customAmounts:
      editingExpense?.split_type === "CUSTOM"
        ? Object.fromEntries(editingExpense.splits.map((s) => [s.participant_id, String(s.amount_owed)]))
        : {},
    quantity: editingExpense?.split_type === "QUANTITY" ? String(editingExpense.quantity ?? "") : "",
    customUnits:
      editingExpense?.split_type === "QUANTITY"
        ? Object.fromEntries(editingExpense.splits.map((s) => [s.participant_id, String(s.units ?? "")]))
        : {},
  };
}

// The add/edit expense form. The parent remounts this component (via a changing `key`) every time
// which expense is being edited changes, including re-clicking Edit on the same expense — so every
// field always seeds itself fresh from `editingExpense` in a useState initializer, the same pattern
// PaymentMethodEditor uses, rather than needing a sync effect.
export function ExpenseForm({
  sessionId,
  participants,
  effectiveSessionPayer,
  editingExpense,
  onSubmitted,
}: {
  sessionId: string;
  participants: Participant[];
  // Live session-wide payer id — read by the "Use <payer>" button, so it stays a prop rather
  // than being baked into an initializer
  effectiveSessionPayer: string;
  // Non-null while this form is editing an existing expense rather than adding a new one
  editingExpense: Expense | null;
  // Called after a successful save; awaited before this component either remounts blank (edit
  // mode) or stays put (add mode, see resetForm below)
  onSubmitted: () => Promise<void>;
}) {
  const seed = seedFromExpense(editingExpense);
  const allParticipantIds = participants.map((p) => p.id);

  const [description, setDescription] = useState(seed.description);
  const [amount, setAmount] = useState(seed.amount);
  const [payerOverride, setPayerOverride] = useState<string | null>(seed.payerOverride);
  const [payerOverrideOpen, setPayerOverrideOpen] = useState(
    editingExpense ? editingExpense.payer.id !== effectiveSessionPayer : false,
  );
  const [splitWith, setSplitWith] = useState<string[] | null>(seed.splitWith);
  const [splitType, setSplitType] = useState<"EVEN" | "CUSTOM" | "QUANTITY">(seed.splitType);
  const [customAmounts, setCustomAmounts] = useState<Record<string, string>>(seed.customAmounts);
  const [quantity, setQuantity] = useState(seed.quantity);
  const [customUnits, setCustomUnits] = useState<Record<string, string>>(seed.customUnits);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // What actually gets submitted: a per-expense override if one is set, otherwise the session-wide payer
  const effectivePaidBy = payerOverride || effectiveSessionPayer;
  const effectiveSplitWith = splitWith ?? allParticipantIds;

  // Toggle one participant in or out of the even split (seeding from the default when untouched)
  function toggleSplitWith(id: string) {
    setSplitWith((prev) => {
      const current = prev ?? allParticipantIds;
      return current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    });
  }

  // Back to blank, add-mode defaults after a successful add (cancel/edit-success both go through
  // a remount instead — see the key above). Clears the per-expense payer override, NOT the
  // session-wide payer — otherwise one overridden expense would poison every expense added
  // afterward in this form.
  function resetForm() {
    setFormError(null);
    setDescription("");
    setAmount("");
    setPayerOverride(null);
    setPayerOverrideOpen(false);
    setSplitWith(null);
    setSplitType("EVEN");
    setCustomAmounts({});
    setQuantity("");
    setCustomUnits({});
  }

  // The expense total, how much is already allocated, and what's still left to split
  const expenseAmount = Number(amount) || 0;
  const customTotal = allParticipantIds.reduce((sum, id) => sum + (Number(customAmounts[id]) || 0), 0);
  const remaining = expenseAmount - customTotal;

  // For a CUSTOM split: update one person's amount, but never let the running total exceed the expense
  function setCustomAmount(id: string, value: string) {
    setCustomAmounts((prev) => {
      if (value === "") return { ...prev, [id]: "" };
      const num = Number(value);
      if (!Number.isFinite(num) || num < 0) return prev; // ignore non-numeric / negative input
      // how much everyone *else* already has, so this person can take at most the rest
      const otherSum = allParticipantIds
        .filter((pid) => pid !== id)
        .reduce((s, pid) => s + (Number(prev[pid]) || 0), 0);
      const cap = Math.max(0, expenseAmount - otherSum);
      if (num > cap) return { ...prev, [id]: String(cap) }; // clamp to the remaining balance
      return { ...prev, [id]: value }; // otherwise keep exactly what they typed (preserves "560." etc.)
    });
  }

  // QUANTITY split: derive unit price + remaining units, and clamp per-person units to the quantity
  const quantityNum = Number(quantity) || 0;
  const unitsTotal = allParticipantIds.reduce((sum, id) => sum + (Number(customUnits[id]) || 0), 0);
  const remainingUnits = quantityNum - unitsTotal;
  const unitPrice = quantityNum > 0 ? expenseAmount / quantityNum : 0;

  function setCustomUnit(id: string, value: string) {
    setCustomUnits((prev) => {
      if (value === "") return { ...prev, [id]: "" };
      const num = Number(value);
      if (!Number.isInteger(num) || num < 0) return prev; // whole units only
      const otherSum = allParticipantIds
        .filter((pid) => pid !== id)
        .reduce((s, pid) => s + (Number(prev[pid]) || 0), 0);
      const cap = Math.max(0, quantityNum - otherSum);
      if (num > cap) return { ...prev, [id]: String(cap) }; // clamp so units can't exceed quantity
      return { ...prev, [id]: value };
    });
  }

  // Validate the form, then POST a new expense or PATCH the one being edited; onSubmitted()
  // refetches after so SWR's cache reflects it
  async function handleSubmitExpense(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);

    const amountNum = Number(amount);
    if (description.trim() === "") {
      setFormError("Add a description");
      return;
    }
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      setFormError("Amount must be greater than 0");
      return;
    }
    if (effectivePaidBy === "") {
      setFormError("Pick who paid");
      return;
    }

    // Build the split portion of the payload differently for EVEN vs CUSTOM
    let splitPayload:
      | { split_type: "EVEN"; participant_ids: string[] }
      | { split_type: "CUSTOM"; splits: { participant_id: string; amount_owed: number }[] }
      | { split_type: "QUANTITY"; quantity: number; splits: { participant_id: string; units: number }[] };

    if (splitType === "EVEN") {
      if (effectiveSplitWith.length === 0) {
        setFormError("Pick at least one person to split with");
        return;
      }
      splitPayload = { split_type: "EVEN", participant_ids: effectiveSplitWith };
    } else if (splitType === "CUSTOM") {
      // Only include people with a positive amount; the backend requires each split > 0
      const splits = allParticipantIds
        .map((id) => ({ participant_id: id, amount_owed: Number(customAmounts[id]) || 0 }))
        .filter((s) => s.amount_owed > 0);
      if (splits.length === 0) {
        setFormError("Enter an amount for at least one person");
        return;
      }
      // Mirror the backend's rule: the custom amounts must sum to the expense total, using the
      // server's own tolerance so the two can't drift
      const sum = splits.reduce((s, x) => s + x.amount_owed, 0);
      if (Math.abs(sum - amountNum) > RECONCILED_EPSILON) {
        setFormError(`₱${(amountNum - sum).toFixed(2)} still needs to be split`);
        return;
      }
      splitPayload = { split_type: "CUSTOM", splits };
    } else {
      // QUANTITY: each person's whole-number units must add up to the total quantity
      if (!Number.isInteger(quantityNum) || quantityNum <= 0) {
        setFormError("Enter a whole-number quantity");
        return;
      }
      const splits = allParticipantIds
        .map((id) => ({ participant_id: id, units: Number(customUnits[id]) || 0 }))
        .filter((s) => s.units > 0);
      if (splits.length === 0) {
        setFormError("Enter units for at least one person");
        return;
      }
      const totalUnits = splits.reduce((s, x) => s + x.units, 0);
      if (totalUnits !== quantityNum) {
        setFormError(`${quantityNum - totalUnits} unit(s) still need assigning`);
        return;
      }
      splitPayload = { split_type: "QUANTITY", quantity: quantityNum, splits };
    }

    setSubmitting(true);
    // Editing an existing expense PATCHes it in place; otherwise POST creates a new one
    const url = editingExpense
      ? `/api/sessions/${sessionId}/expenses/${editingExpense.id}`
      : `/api/sessions/${sessionId}/expenses`;
    const res = await fetch(url, {
      method: editingExpense ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: description.trim(),
        amount: amountNum,
        paid_by: effectivePaidBy,
        ...splitPayload,
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setFormError(body.error ?? (editingExpense ? "Failed to save changes" : "Failed to add expense"));
      setSubmitting(false);
      return;
    }

    const wasAdding = !editingExpense;
    if (wasAdding) resetForm(); // add→add: key never changes, must reset locally
    await onSubmitted(); // edit mode: stays mounted (still disabled) until this resolves, then
    // the parent clears editingExpense and this instance unmounts via the key change
    // No setSubmitting(false) on the edit path — the remount above has already unmounted this
    // component by the time this line would run; only the add path is still here to update.
    if (wasAdding) setSubmitting(false);
  }

  return (
    <form onSubmit={handleSubmitExpense} className="flex flex-col gap-3">
      <input
        type="text"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="What was it? (e.g. Chili Cheese Fries)"
        className="input"
      />
      <input
        type="text"
        inputMode="decimal"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="Amount (₱)"
        className="input"
      />

      {/* Collapsed by default — the session-wide payer picker above already covers the
          common case, so this only expands when this one expense needs a different payer */}
      {payerOverrideOpen ? (
        /* Restates the form's own flex layout — a bare wrapper would collapse the label
           row and select into one flex child and drop the gap between them */
        <div className="panel-reveal flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <label htmlFor="payer-override" className="text-sm font-medium text-navy">
              Paid by
            </label>
            <button
              type="button"
              onClick={() => {
                // EDIT mode pins to the concrete id rather than null, which would resume
                // tracking the live session payer until Save.
                setPayerOverride(editingExpense ? effectiveSessionPayer : null);
                setPayerOverrideOpen(false);
              }}
              className="text-sm font-medium text-navy/50"
            >
              Use {participants.find((p) => p.id === effectiveSessionPayer)?.name ?? "session payer"}
            </button>
          </div>
          <select
            id="payer-override"
            value={effectivePaidBy}
            onChange={(e) => setPayerOverride(e.target.value)}
            className="input"
          >
            {participants.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <p className="text-sm text-navy/60">
          Paid by {participants.find((p) => p.id === effectivePaidBy)?.name ?? "—"} ·{" "}
          <button
            type="button"
            onClick={() => setPayerOverrideOpen(true)}
            className="font-medium text-teal underline"
          >
            Change
          </button>
        </p>
      )}

      {/* Toggle between the three split modes */}
      <div className="flex gap-2">
        {(["EVEN", "QUANTITY", "CUSTOM"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => setSplitType(mode)}
            className={`btn-toggle ${splitType === mode ? "btn-toggle-active" : "btn-toggle-inactive"}`}
          >
            {mode === "EVEN" ? "Evenly" : mode === "QUANTITY" ? "Quantity" : "Amount"}
          </button>
        ))}
      </div>

      {splitType === "EVEN" ? (
        // Even split: check who shares this expense
        <div className="flex flex-col gap-1.5">
          {participants.map((p) => (
            <label key={p.id} className="flex items-center gap-2 text-base text-navy">
              <input
                type="checkbox"
                checked={effectiveSplitWith.includes(p.id)}
                onChange={() => toggleSplitWith(p.id)}
                className="accent-teal"
              />
              {p.name}
            </label>
          ))}
        </div>
      ) : splitType === "QUANTITY" ? (
        // By quantity: enter total quantity, then each person's units; backend computes amounts
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-navy">Total quantity</label>
          <input
            type="text"
            inputMode="numeric"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="e.g. 6"
            className="input"
          />
          {expenseAmount > 0 && quantityNum > 0 ? (
            <p className="text-xs text-navy/50">₱{unitPrice.toFixed(2)} per unit</p>
          ) : (
            <p className="text-xs text-navy/40">Enter the amount and quantity first, then assign units.</p>
          )}
          {participants.map((p) => (
            <label key={p.id} className="flex items-center justify-between gap-2 text-base text-navy">
              <span>{p.name}</span>
              <input
                type="text"
                inputMode="numeric"
                value={customUnits[p.id] ?? ""}
                onChange={(e) => setCustomUnit(p.id, e.target.value)}
                placeholder="0"
                disabled={expenseAmount <= 0 || quantityNum <= 0}
                className="w-20 rounded-lg border border-navy/20 px-2 py-1 text-right text-base focus:outline-none focus:ring-1 focus:ring-teal/40 disabled:bg-beige"
              />
            </label>
          ))}
          <div className="mt-1 flex justify-between text-sm">
            <span className="text-navy/50">Units remaining</span>
            <span className={quantityNum > 0 && remainingUnits === 0 ? "font-medium text-teal" : "text-navy/50"}>
              {remainingUnits}
            </span>
          </div>
        </div>
      ) : (
        // Custom split: enter each person's amount; the remaining balance updates live
        <div className="flex flex-col gap-2">
          {expenseAmount <= 0 && (
            <p className="text-xs text-navy/40">Enter the amount above first, then split it below.</p>
          )}
          {participants.map((p) => (
            <label key={p.id} className="flex items-center justify-between gap-2 text-base text-navy">
              <span>{p.name}</span>
              <input
                type="text"
                inputMode="decimal"
                value={customAmounts[p.id] ?? ""}
                onChange={(e) => setCustomAmount(p.id, e.target.value)}
                placeholder="0.00"
                disabled={expenseAmount <= 0}
                className="w-24 rounded-lg border border-navy/20 px-2 py-1 text-right text-base focus:outline-none focus:ring-1 focus:ring-teal/40 disabled:bg-beige"
              />
            </label>
          ))}
          <div className="mt-1 flex justify-between text-sm">
            <span className="text-navy/50">Remaining to split</span>
            {/* Teal when the split is balanced — same threshold as the submit guard */}
            <span className={expenseAmount > 0 && Math.abs(remaining) <= RECONCILED_EPSILON ? "font-medium text-teal" : "text-navy/50"}>
              ₱{remaining.toFixed(2)}
            </span>
          </div>
        </div>
      )}

      {formError && <p className="text-sm text-red-500">{formError}</p>}

      <button type="submit" disabled={submitting} className="btn-primary">
        {editingExpense
          ? submitting
            ? "Saving…"
            : "Save changes"
          : submitting
            ? "Adding…"
            : "Add expense"}
      </button>
    </form>
  );
}
