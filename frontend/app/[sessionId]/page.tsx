"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import useSWR from "swr";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
  arrayMove,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { saveRecentSession } from "@/lib/recentSessions";
import { parseBankDetails, formatBankDetails } from "@/lib/paymentDetails";
import { apiUrl } from "@/lib/apiUrl";
import { fetcher } from "@/lib/fetcher";

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

// One draggable expense card. Pulled out as its own component (rather than inlined in a .map())
// because useSortable must be called once per item, and hooks can't be called inside a callback.
function SortableExpenseCard({
  expense,
  onEdit,
  onDelete,
  isDeleting,
}: {
  expense: Expense;
  onEdit: (expense: Expense) => void;
  onDelete: (expenseId: string) => void;
  isDeleting: boolean;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: expense.id,
  });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <li ref={setNodeRef} style={style} className={`card-navy p-4 ${isDragging ? "opacity-50" : ""}`}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          {/* Drag handle: only this icon starts a drag, so tapping the card or the edit/delete
              buttons next to it is never mistaken for the start of a reorder */}
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            aria-label="Reorder expense"
            className="cursor-grab touch-none px-1 text-white/30 active:cursor-grabbing"
          >
            ⠿
          </button>
          <span className="font-semibold text-white">{expense.description}</span>
        </div>
        <div className="ml-2 flex shrink-0 items-center gap-2">
          <span className="font-semibold text-white">₱{expense.amount.toFixed(2)}</span>
          {/* Edit button: loads this expense into the form below, pre-filled */}
          <button
            type="button"
            onClick={() => onEdit(expense)}
            aria-label="Edit expense"
            className="px-1 text-white/40 transition-colors hover:text-teal"
          >
            ✎
          </button>
          {/* Delete button: small tap target, grays out while the request is in flight */}
          <button
            type="button"
            onClick={() => onDelete(expense.id)}
            disabled={isDeleting}
            aria-label="Delete expense"
            className="px-1 text-white/40 transition-colors hover:text-red-400 disabled:opacity-40"
          >
            {isDeleting ? "…" : "✕"}
          </button>
        </div>
      </div>
      <p className="mt-1 text-sm text-white/60">
        Paid by {expense.payer.name} ·{" "}
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
    </li>
  );
}

// Session view: show the bill, who's in it, every expense, and a form to add more
export default function SessionPage() {
  // useParams reads the [sessionId] segment from the URL (returned directly in a client component)
  const { sessionId } = useParams<{ sessionId: string }>();

  // SWR owns the fetching, caching, and re-render — no useEffect/useState/useCallback for the data.
  // mutate() re-runs the fetcher so we can refresh the list after adding an expense.
  const { data: session, error, mutate } = useSWR<Session>(
    sessionId ? apiUrl(`/api/sessions/${sessionId}`) : null,
    (url: string) => fetcher(url, "Failed to load session"),
  );

  // Once the session loads, remember it on this device — covers both "just created it"
  // and "opened a shared link", so either way it shows up in "Your recent sessions".
  useEffect(() => {
    if (session) saveRecentSession(session.id, session.name);
  }, [session?.id, session?.name]);

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
  // Which expense is currently being deleted (shows a spinner in that row), and any delete error
  const [deletingExpenseId, setDeletingExpenseId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Non-null while the form below is editing an existing expense rather than adding a new one
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  // So tapping "Edit" can scroll the (always-rendered) form into view on mobile
  const addExpenseSectionRef = useRef<HTMLElement>(null);
  // Set if a drag-reorder's PATCH fails after the optimistic UI update already applied
  const [reorderError, setReorderError] = useState<string | null>(null);
  // Pointer (mouse/touch, via the drag handle) + keyboard (arrow keys, for accessibility)
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  // Tracks whether the share-link copy button just fired, to show "Copied!" briefly
  const [copiedShareLink, setCopiedShareLink] = useState(false);
  // Same, for the "copy session link" button (this session's own edit URL, so it can be reopened later)
  const [copiedSessionLink, setCopiedSessionLink] = useState(false);

  // Payment-method form state: which participant's inline form is open, and its fields
  const [expandedParticipantId, setExpandedParticipantId] = useState<string | null>(null);
  const [paymentMethodType, setPaymentMethodType] = useState<"GCASH" | "MAYA" | "BANK_TRANSFER">("GCASH");
  const [paymentDetails, setPaymentDetails] = useState(""); // phone number for GCash/Maya; account number for bank transfer
  const [bankName, setBankName] = useState(""); // bank transfer only — stored combined as "BankName - AccountNumber"
  const [savingPaymentMethod, setSavingPaymentMethod] = useState(false);
  const [paymentMethodError, setPaymentMethodError] = useState<string | null>(null);

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

  // Expand one participant's payment-method form, seeded with whatever they already have saved
  // (or collapse it if it's already open — tapping the same row again closes it)
  function toggleExpandParticipant(p: Participant) {
    if (expandedParticipantId === p.id) {
      setExpandedParticipantId(null);
      return;
    }
    setExpandedParticipantId(p.id);
    setPaymentMethodType((p.payment_method_type as "GCASH" | "MAYA" | "BANK_TRANSFER") || "GCASH");
    setPaymentMethodError(null);

    // Bank transfer is stored as "Bank Name - Account Number" — split into the two separate fields
    if (p.payment_method_type === "BANK_TRANSFER" && p.payment_details) {
      const { bankName, accountNumber } = parseBankDetails(p.payment_details);
      setBankName(bankName);
      setPaymentDetails(accountNumber);
    } else {
      setBankName("");
      setPaymentDetails(p.payment_details ?? "");
    }
  }

  // Save one participant's payment method, then collapse the form and refetch the session
  async function handleSavePaymentMethod(participantId: string) {
    setPaymentMethodError(null);

    // Bank transfer needs two fields; GCash/Maya just need the phone number
    let details: string;
    if (paymentMethodType === "BANK_TRANSFER") {
      if (bankName.trim() === "") { setPaymentMethodError("Enter the bank name"); return; }
      if (paymentDetails.trim() === "") { setPaymentMethodError("Enter the account number"); return; }
      // Combine into the stored format — only the account number is copied on the settle screen
      details = formatBankDetails(bankName.trim(), paymentDetails.trim());
    } else {
      if (paymentDetails.trim() === "") { setPaymentMethodError("Enter your phone number"); return; }
      details = paymentDetails.trim();
    }

    setSavingPaymentMethod(true);
    const res = await fetch(
      apiUrl(`/api/sessions/${sessionId}/participants/${participantId}`),
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payment_method_type: paymentMethodType, payment_details: details }),
      },
    );

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setPaymentMethodError(body.error ?? "Failed to save payment method");
      setSavingPaymentMethod(false);
      return;
    }

    setExpandedParticipantId(null);
    await mutate();
    setSavingPaymentMethod(false);
  }

  // Confirm then DELETE the expense; refetch so the list reflects the removal immediately
  async function handleDeleteExpense(expenseId: string) {
    if (!window.confirm("Remove this expense?")) return;
    setDeleteError(null);
    setDeletingExpenseId(expenseId);
    const res = await fetch(
      apiUrl(`/api/sessions/${sessionId}/expenses/${expenseId}`),
      { method: "DELETE" },
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setDeleteError(body.error ?? "Failed to delete expense");
      setDeletingExpenseId(null);
      return;
    }
    await mutate();
    setDeletingExpenseId(null);
  }

  // Reorders expenses on drag-end: shows the new order immediately (optimistic), PATCHes it to
  // the backend, then reconciles — or reverts, via the plain mutate() below, if that PATCH fails
  async function handleDragEnd(event: DragEndEvent) {
    // TS doesn't carry the outer `if (!session) return` guard's narrowing into this nested
    // function, since it could in principle run later — so it needs its own local guard
    if (!session) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = session.expenses.findIndex((exp) => exp.id === active.id);
    const newIndex = session.expenses.findIndex((exp) => exp.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(session.expenses, oldIndex, newIndex);
    setReorderError(null);
    await mutate({ ...session, expenses: reordered }, { revalidate: false });

    const res = await fetch(apiUrl(`/api/sessions/${sessionId}/expenses`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expense_ids: reordered.map((exp) => exp.id) }),
    });

    if (!res.ok) {
      setReorderError("Failed to save the new order");
    }
    await mutate(); // reconciles with the server, or reverts the optimistic update on failure
  }

  // Shared by "cancel edit" and "after a successful add/save" — back to blank, add-mode defaults
  function resetForm() {
    setEditingExpenseId(null);
    setFormError(null);
    setDescription("");
    setAmount("");
    setPaidBy("");
    setSplitWith(null);
    setSplitType("EVEN");
    setCustomAmounts({});
    setQuantity("");
    setCustomUnits({});
  }

  // Populate the (always-rendered) form from an existing expense, then scroll it into view —
  // otherwise a tap on "Edit" up in the list leaves the form off-screen below the fold
  function handleStartEdit(expense: Expense) {
    setEditingExpenseId(expense.id);
    setFormError(null);
    setDescription(expense.description);
    setAmount(String(expense.amount));
    setPaidBy(expense.payer.id);
    setSplitType(expense.split_type);
    setSplitWith(expense.split_type === "EVEN" ? expense.splits.map((s) => s.participant_id) : null);
    setCustomAmounts(
      expense.split_type === "CUSTOM"
        ? Object.fromEntries(expense.splits.map((s) => [s.participant_id, String(s.amount_owed)]))
        : {},
    );
    setQuantity(expense.split_type === "QUANTITY" ? String(expense.quantity ?? "") : "");
    setCustomUnits(
      expense.split_type === "QUANTITY"
        ? Object.fromEntries(expense.splits.map((s) => [s.participant_id, String(s.units ?? "")]))
        : {},
    );
    addExpenseSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
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

  // Validate the form, then POST a new expense or PATCH the one being edited; mutate() after
  // so SWR refetches and the list reflects it
  async function handleSubmitExpense(e: React.SubmitEvent<HTMLFormElement>) {
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
    // Editing an existing expense PATCHes it in place; otherwise POST creates a new one
    const url = editingExpenseId
      ? apiUrl(`/api/sessions/${sessionId}/expenses/${editingExpenseId}`)
      : apiUrl(`/api/sessions/${sessionId}/expenses`);
    const res = await fetch(url, {
      method: editingExpenseId ? "PATCH" : "POST",
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
      setFormError(body.error ?? (editingExpenseId ? "Failed to save changes" : "Failed to add expense"));
      setSubmitting(false);
      return;
    }

    // Back to blank, add-mode defaults, then tell SWR to refetch so the change appears
    resetForm();
    await mutate();
    setSubmitting(false);
  }

  return (
    <main className="flex-1 flex flex-col items-center px-4 py-8">
      <div className="w-full max-w-sm">
        {/* Back to the home page, e.g. to start or return to a different session */}
        <Link href="/" className="mb-4 inline-block text-sm font-medium text-teal">
          ← Home
        </Link>
        <h1 className="text-2xl font-bold text-navy mb-1">{session.name}</h1>
        <p className="text-sm text-navy/50 mb-8">{session.participants.length} people</p>

        {/* Participants — tap a row to set that person's payment method for the settle screen */}
        <section className="mb-8">
          <h2 className="section-label">Who&apos;s splitting</h2>
          <ul className="flex flex-col gap-2">
            {session.participants.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => toggleExpandParticipant(p)}
                  className="card flex w-full items-center justify-between px-4 py-3 text-left text-sm"
                >
                  <span className="font-medium text-navy">{p.name}</span>
                  <span className={`text-xs ${p.payment_method_type ? "text-teal font-medium" : "text-navy/40"}`}>
                    {p.payment_method_type
                      ? `${
                          p.payment_method_type === "GCASH"
                            ? "GCash"
                            : p.payment_method_type === "MAYA"
                              ? "Maya"
                              : "Bank"
                        } ✓`
                      : "Add payment method"}
                  </span>
                </button>

                {expandedParticipantId === p.id && (
                  // Inline form: pick a method, enter the detail, save via PATCH
                  <div className="mt-2 flex flex-col gap-2 rounded-2xl border border-navy/10 bg-white p-4 shadow-sm">
                    <div className="flex gap-2">
                      {(["GCASH", "MAYA", "BANK_TRANSFER"] as const).map((type) => (
                        <button
                          key={type}
                          type="button"
                          onClick={() => setPaymentMethodType(type)}
                          className={`btn-toggle ${paymentMethodType === type ? "btn-toggle-active" : "btn-toggle-inactive"}`}
                        >
                          {type === "GCASH" ? "GCash" : type === "MAYA" ? "Maya" : "Bank"}
                        </button>
                      ))}
                    </div>
                    {paymentMethodType === "BANK_TRANSFER" ? (
                      // Two separate fields — combined on save so only the account number is copied later
                      <>
                        <input
                          type="text"
                          value={bankName}
                          onChange={(e) => setBankName(e.target.value)}
                          placeholder="Bank name (e.g. BPI)"
                          className="input"
                        />
                        <input
                          type="text"
                          inputMode="numeric"
                          value={paymentDetails}
                          onChange={(e) => setPaymentDetails(e.target.value)}
                          placeholder="Account number"
                          className="input"
                        />
                      </>
                    ) : (
                      <input
                        type="text"
                        inputMode="numeric"
                        value={paymentDetails}
                        onChange={(e) => setPaymentDetails(e.target.value)}
                        placeholder="Phone number"
                        className="input"
                      />
                    )}
                    {paymentMethodError && <p className="text-sm text-red-500">{paymentMethodError}</p>}
                    <button
                      type="button"
                      onClick={() => handleSavePaymentMethod(p.id)}
                      disabled={savingPaymentMethod}
                      className="btn-compact self-end disabled:opacity-50"
                    >
                      {savingPaymentMethod ? "Saving…" : "Save"}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>

        {/* Expenses */}
        <section>
          <h2 className="section-label">Expenses</h2>
          {deleteError && <p className="mb-2 text-sm text-red-500">{deleteError}</p>}
          {reorderError && <p className="mb-2 text-sm text-red-500">{reorderError}</p>}
          {session.expenses.length === 0 ? (
            <p className="text-sm text-navy/40">No expenses yet.</p>
          ) : (
            <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={session.expenses.map((e) => e.id)} strategy={verticalListSortingStrategy}>
                <ul className="flex flex-col gap-3">
                  {session.expenses.map((e) => (
                    <SortableExpenseCard
                      key={e.id}
                      expense={e}
                      onEdit={handleStartEdit}
                      onDelete={handleDeleteExpense}
                      isDeleting={deletingExpenseId === e.id}
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          )}
        </section>

        {/* Add or edit an expense — the same form serves both; editingExpenseId picks the mode */}
        <section ref={addExpenseSectionRef} className="mt-8 border-t border-navy/10 pt-6">
          <div className="flex items-center justify-between">
            <h2 className="section-label">{editingExpenseId ? "Edit expense" : "Add an expense"}</h2>
            {editingExpenseId && (
              <button type="button" onClick={resetForm} className="text-sm font-medium text-navy/50">
                Cancel
              </button>
            )}
          </div>
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

            <label className="text-sm font-medium text-navy">Paid by</label>
            <select
              value={effectivePaidBy}
              onChange={(e) => setPaidBy(e.target.value)}
              className="input"
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
                  className={`btn-toggle ${splitType === mode ? "btn-toggle-active" : "btn-toggle-inactive"}`}
                >
                  {mode === "EVEN" ? "Evenly" : mode === "QUANTITY" ? "Quantity" : "Amount"}
                </button>
              ))}
            </div>

            {splitType === "EVEN" ? (
              // Even split: check who shares this expense
              <div className="flex flex-col gap-1.5">
                {session.participants.map((p) => (
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
                {session.participants.map((p) => (
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
                {session.participants.map((p) => (
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
                  <span className={expenseAmount > 0 && Math.abs(remaining) < 0.01 ? "font-medium text-teal" : "text-navy/50"}>
                    ₱{remaining.toFixed(2)}
                  </span>
                </div>
              </div>
            )}

            {formError && <p className="text-sm text-red-500">{formError}</p>}

            <button type="submit" disabled={submitting} className="btn-primary">
              {editingExpenseId
                ? submitting
                  ? "Saving…"
                  : "Save changes"
                : submitting
                  ? "Adding…"
                  : "Add expense"}
            </button>
          </form>
        </section>

        {/* Copy this session's own (editable) URL, so it can be pasted somewhere and reopened later */}
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(`${window.location.origin}/${sessionId}`);
            setCopiedSessionLink(true);
            setTimeout(() => setCopiedSessionLink(false), 2000);
          }}
          className="btn-secondary mt-6"
        >
          {copiedSessionLink ? "Link copied!" : "Copy session link"}
        </button>

        {/* Share a read-only link with participants so they can see what they owe */}
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(`${window.location.origin}/${sessionId}/view`);
            setCopiedShareLink(true);
            setTimeout(() => setCopiedShareLink(false), 2000);
          }}
          className="btn-secondary mt-3"
        >
          {copiedShareLink ? "Link copied!" : "Share view link"}
        </button>

        {/* Settlement screen: who owes who, plus mark-as-paid tracking once finalized */}
        <Link href={`/${sessionId}/settle`} className="btn-primary mt-3">
          Settle up
        </Link>
      </div>
    </main>
  );
}
