"use client";

import { useState } from "react";
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
import { SessionPayerNote } from "@/components/SessionPayerNote";
import { ExpenseRow } from "@/components/ExpenseRow";
import type { Expense, Session } from "@/lib/types";
import type { KeyedMutator } from "swr";

// One draggable expense card. Pulled out as its own component (rather than inlined in a .map())
// because useSortable must be called once per item, and hooks can't be called inside a callback.
function SortableExpenseCard({
  expense,
  onEdit,
  onDelete,
  isDeleting,
  hidePayerName,
}: {
  expense: Expense;
  onEdit: (expense: Expense) => void;
  onDelete: (expenseId: string) => void;
  isDeleting: boolean;
  // Forwarded straight through to ExpenseRow, which owns the "Paid by" guard this drives.
  hidePayerName: boolean;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: expense.id,
  });
  // Lift the card while dragging; merged inline because dnd-kit sets `transition` on this node
  const style = {
    transform: CSS.Transform.toString(transform),
    transition: [transition, "box-shadow 160ms var(--ease-out)"].filter(Boolean).join(", "),
    boxShadow: isDragging ? "var(--shadow-md)" : undefined,
  };

  return (
    <li ref={setNodeRef} style={style} className={`card-navy p-4 ${isDragging ? "opacity-50" : ""}`}>
      {/* enter-rise lives here, not on the <li> — dnd-kit already drives that element's own
          transform/transition, and a second transform on the same node would fight it */}
      <div className="enter-rise">
        <ExpenseRow
          expense={expense}
          hidePayerName={hidePayerName}
          leading={
            // Drag handle: only this icon starts a drag, so tapping the card or the edit/delete
            // buttons next to it is never mistaken for the start of a reorder
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
          }
          actions={
            <>
              {/* Edit button: loads this expense into the form below, pre-filled */}
              <button
                type="button"
                onClick={() => onEdit(expense)}
                aria-label="Edit expense"
                className="icon-btn px-1 text-white/40 hover:text-teal"
              >
                ✎
              </button>
              {/* Delete button: small tap target, grays out while the request is in flight */}
              <button
                type="button"
                onClick={() => onDelete(expense.id)}
                disabled={isDeleting}
                aria-label="Delete expense"
                className="icon-btn px-1 text-white/40 hover:text-red-400 disabled:opacity-40"
              >
                {isDeleting ? "…" : "✕"}
              </button>
            </>
          }
        />
      </div>
    </li>
  );
}

// The expense list: drag-to-reorder, delete, and the "who's paying" note above them. Owns its own
// delete/reorder/drag state since neither has anything to do with the add/edit form beside it.
export function ExpenseList({
  sessionId,
  session,
  mutate,
  derivedSessionPayer,
  onEdit,
  onDeleted,
}: {
  sessionId: string;
  session: Session;
  // Refetches the session — called after every delete and after a reorder PATCH settles
  mutate: KeyedMutator<Session>;
  // Non-null only when every expense shares one payer — drives whether rows repeat "Paid by X"
  derivedSessionPayer: { id: string; name: string } | null;
  // Loads an expense into the form below, pre-filled
  onEdit: (expense: Expense) => void;
  // Fires after a successful delete; the parent clears its editingExpense if it matches
  onDeleted: (expenseId: string) => void;
}) {
  // Which expense is currently being deleted (shows a spinner in that row), and any delete error
  const [deletingExpenseId, setDeletingExpenseId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Set if a drag-reorder's PATCH fails after the optimistic UI update already applied
  const [reorderError, setReorderError] = useState<string | null>(null);
  // Pointer (mouse/touch, via the drag handle) + keyboard (arrow keys, for accessibility)
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Confirm then DELETE the expense; refetch so the list reflects the removal immediately
  async function handleDeleteExpense(expenseId: string) {
    if (!window.confirm("Remove this expense?")) return;
    setDeleteError(null);
    setDeletingExpenseId(expenseId);
    const res = await fetch(`/api/sessions/${sessionId}/expenses/${expenseId}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setDeleteError(body.error ?? "Failed to delete expense");
      setDeletingExpenseId(null);
      return;
    }
    onDeleted(expenseId);
    await mutate();
    setDeletingExpenseId(null);
  }

  // Reorders expenses on drag-end: shows the new order immediately (optimistic), PATCHes it to
  // the backend, then reconciles — or reverts, via the plain mutate() below, if that PATCH fails
  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = session.expenses.findIndex((exp) => exp.id === active.id);
    const newIndex = session.expenses.findIndex((exp) => exp.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(session.expenses, oldIndex, newIndex);
    setReorderError(null);
    await mutate({ ...session, expenses: reordered }, { revalidate: false });

    const res = await fetch(`/api/sessions/${sessionId}/expenses`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expense_ids: reordered.map((exp) => exp.id) }),
    });

    if (!res.ok) {
      setReorderError("Failed to save the new order");
    }
    await mutate(); // reconciles with the server, or reverts the optimistic update on failure
  }

  return (
    <section>
      <h2 className="section-label">Expenses</h2>
      {/* Named once here instead of on every card below — only true once every expense
          shares one payer; a mixed session falls back to naming the payer per row */}
      <SessionPayerNote payer={derivedSessionPayer} className="-mt-2 mb-3 text-sm text-navy/40" />
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
                  onEdit={onEdit}
                  onDelete={handleDeleteExpense}
                  isDeleting={deletingExpenseId === e.id}
                  hidePayerName={!!derivedSessionPayer}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
    </section>
  );
}
