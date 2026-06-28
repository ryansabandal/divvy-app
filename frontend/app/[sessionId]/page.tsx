"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import useSWR from "swr";

// Shape of the data returned by GET /api/sessions/:sessionId
interface Participant {
  id: string;
  name: string;
  payment_method_type: string | null;
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

// SWR calls this with the key (the URL); it returns the parsed JSON or throws on a bad response
const fetcher = (url: string) =>
  fetch(url).then((res) => {
    if (!res.ok) {
      throw new Error(res.status === 404 ? "Session not found" : "Failed to load session");
    }
    return res.json();
  });

// Session view: show the bill, who's in it, every expense, and a form to add more
export default function SessionPage() {
  // useParams reads the [sessionId] segment from the URL (returned directly in a client component)
  const { sessionId } = useParams<{ sessionId: string }>();

  // SWR owns the fetching, caching, and re-render — no useEffect/useState/useCallback for the data.
  // mutate() re-runs the fetcher so we can refresh the list after adding an expense.
  const { data: session, error, mutate } = useSWR<Session>(
    sessionId ? `${process.env.NEXT_PUBLIC_API_URL}/api/sessions/${sessionId}` : null,
    fetcher,
  );

  // Add-expense form state
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [paidBy, setPaidBy] = useState("");
  const [splitWith, setSplitWith] = useState<string[] | null>(null);
  const [splitType, setSplitType] = useState<"EVEN" | "CUSTOM" | "QUANTITY">("EVEN");
  const [customAmounts, setCustomAmounts] = useState<Record<string, string>>({});
  const [quantity, setQuantity] = useState("");
  const [customUnits, setCustomUnits] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  if (error) {
    return <main className="flex-1 px-4 py-10 text-center text-red-600">{error.message}</main>;
  }
  if (!session) {
    return <main className="flex-1 px-4 py-10 text-center text-gray-500">Loading…</main>;
  }

  // Defaults derived at render time (never via a setState in an effect): until the user picks a
  // payer or unchecks someone, fall back to "first participant" and "everyone".
  const allParticipantIds = session.participants.map((p) => p.id);
  const effectivePaidBy = paidBy || allParticipantIds[0] || "";
  const effectiveSplitWith = splitWith ?? allParticipantIds;

  // Toggle one participant in or out of the even split (seeding from the default when untouched)
  function toggleSplitWith(id: string) {
    setSplitWith((prev) => {
      const current = prev ?? allParticipantIds;
      return current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    });
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

  // Validate the form, POST the expense, then mutate() so SWR refetches and shows it
  async function handleAddExpense(e: React.SubmitEvent<HTMLFormElement>) {
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
      // Mirror the backend's rule: the custom amounts must sum to the expense total
      const sum = splits.reduce((s, x) => s + x.amount_owed, 0);
      if (Math.abs(sum - amountNum) > 0.01) {
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
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/sessions/${sessionId}/expenses`, {
      method: "POST",
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
      setFormError(body.error ?? "Failed to add expense");
      setSubmitting(false);
      return;
    }

    // Reset the form back to defaults, then tell SWR to refetch so the new expense appears
    setDescription("");
    setAmount("");
    setPaidBy("");
    setSplitWith(null);
    setSplitType("EVEN");
    setCustomAmounts({});
    setQuantity("");
    setCustomUnits({});
    await mutate();
    setSubmitting(false);
  }

  return (
    <main className="flex-1 flex flex-col items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold mb-1">{session.name}</h1>
        <p className="text-sm text-gray-500 mb-6">{session.participants.length} people</p>

        {/* Participants */}
        <section className="mb-8">
          <h2 className="text-sm font-medium mb-2">Who&apos;s splitting</h2>
          <ul className="flex flex-wrap gap-2">
            {session.participants.map((p) => (
              <li key={p.id} className="rounded-full bg-gray-100 px-3 py-1 text-sm">
                {p.name}
              </li>
            ))}
          </ul>
        </section>

        {/* Expenses */}
        <section>
          <h2 className="text-sm font-medium mb-2">Expenses</h2>
          {session.expenses.length === 0 ? (
            <p className="text-sm text-gray-400">No expenses yet.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {session.expenses.map((e) => (
                <li key={e.id} className="rounded-md border border-gray-200 p-3">
                  <div className="flex justify-between">
                    <span className="font-medium">{e.description}</span>
                    <span className="font-medium">₱{e.amount.toFixed(2)}</span>
                  </div>
                  <p className="text-sm text-gray-500 mt-1">
                    Paid by {e.payer.name} ·{" "}
                    {e.split_type === "EVEN"
                      ? "split evenly"
                      : e.split_type === "QUANTITY" && e.quantity
                        ? `${e.quantity} units · ₱${(e.amount / e.quantity).toFixed(2)} each`
                        : "custom split"}
                  </p>
                  {/* Per-person breakdown of who owes what for this one expense */}
                  <ul className="mt-2 flex flex-col gap-0.5 text-xs text-gray-400">
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

        {/* Add an expense (even split only for now) */}
        <section className="mt-8 border-t border-gray-200 pt-6">
          <h2 className="text-sm font-medium mb-3">Add an expense</h2>
          <form onSubmit={handleAddExpense} className="flex flex-col gap-3">
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What was it? (e.g. Chili Cheese Fries)"
              className="rounded-md border border-gray-300 px-3 py-2 text-base"
            />
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Amount"
              className="rounded-md border border-gray-300 px-3 py-2 text-base"
            />

            <label className="text-sm font-medium">Paid by</label>
            <select
              value={effectivePaidBy}
              onChange={(e) => setPaidBy(e.target.value)}
              className="rounded-md border border-gray-300 px-3 py-2 text-base"
            >
              {session.participants.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>

            {/* Toggle between the three split modes */}
            <div className="flex gap-2">
              {(["EVEN", "QUANTITY", "CUSTOM"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setSplitType(mode)}
                  className={`flex-1 rounded-md border py-2 text-sm font-medium ${
                    splitType === mode ? "border-black bg-black text-white" : "border-gray-300"
                  }`}
                >
                  {mode === "EVEN" ? "Evenly" : mode === "QUANTITY" ? "Quantity" : "Amount"}
                </button>
              ))}
            </div>

            {splitType === "EVEN" ? (
              // Even split: check who shares this expense
              <div className="flex flex-col gap-1">
                {session.participants.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 text-base">
                    <input
                      type="checkbox"
                      checked={effectiveSplitWith.includes(p.id)}
                      onChange={() => toggleSplitWith(p.id)}
                    />
                    {p.name}
                  </label>
                ))}
              </div>
            ) : splitType === "QUANTITY" ? (
              // By quantity: enter total quantity, then each person's units; backend computes amounts
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">Total quantity</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="e.g. 6"
                  className="rounded-md border border-gray-300 px-3 py-2 text-base"
                />
                {expenseAmount > 0 && quantityNum > 0 ? (
                  <p className="text-xs text-gray-400">₱{unitPrice.toFixed(2)} per unit</p>
                ) : (
                  <p className="text-xs text-gray-400">Enter the amount and quantity first, then assign units.</p>
                )}
                {session.participants.map((p) => (
                  <label key={p.id} className="flex items-center justify-between gap-2 text-base">
                    <span>{p.name}</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={customUnits[p.id] ?? ""}
                      onChange={(e) => setCustomUnit(p.id, e.target.value)}
                      placeholder="0"
                      disabled={expenseAmount <= 0 || quantityNum <= 0}
                      className="w-20 rounded-md border border-gray-300 px-2 py-1 text-right text-base disabled:bg-gray-100"
                    />
                  </label>
                ))}
                <div className="mt-1 flex justify-between text-sm">
                  <span className="text-gray-500">Units remaining</span>
                  <span className={quantityNum > 0 && remainingUnits === 0 ? "text-green-600" : "text-gray-500"}>
                    {remainingUnits}
                  </span>
                </div>
              </div>
            ) : (
              // Custom split: enter each person's amount; the remaining balance updates live
              <div className="flex flex-col gap-2">
                {expenseAmount <= 0 && (
                  <p className="text-xs text-gray-400">Enter the amount above first, then split it below.</p>
                )}
                {session.participants.map((p) => (
                  <label key={p.id} className="flex items-center justify-between gap-2 text-base">
                    <span>{p.name}</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={customAmounts[p.id] ?? ""}
                      onChange={(e) => setCustomAmount(p.id, e.target.value)}
                      placeholder="0.00"
                      disabled={expenseAmount <= 0}
                      className="w-24 rounded-md border border-gray-300 px-2 py-1 text-right text-base disabled:bg-gray-100"
                    />
                  </label>
                ))}
                <div className="mt-1 flex justify-between text-sm">
                  <span className="text-gray-500">Remaining to split</span>
                  <span className={expenseAmount > 0 && Math.abs(remaining) < 0.01 ? "text-green-600" : "text-gray-500"}>
                    ₱{remaining.toFixed(2)}
                  </span>
                </div>
              </div>
            )}

            {formError && <p className="text-sm text-red-600">{formError}</p>}

            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-black text-white py-3 text-base font-medium disabled:opacity-50"
            >
              {submitting ? "Adding…" : "Add expense"}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
