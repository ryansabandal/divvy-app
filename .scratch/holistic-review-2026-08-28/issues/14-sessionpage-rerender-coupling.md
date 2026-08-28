Status: needs-triage
Severity: Low
Category: Performance

# Expense-form state living in the same component as the expense list causes a full re-render per keystroke

`SessionPage` holds 20 `useState` hooks across four unrelated concerns (add/edit expense form, payment-method editor, drag-and-drop, clipboard buttons) in one ~1000-line component. Because form state (`description`, `amount`, etc.) lives in the same component that renders the expense list, every keystroke in the description or amount field re-renders the entire list.

Location: app/[sessionId]/page.tsx:123-1042

Mechanism, not estimate: `SortableContext`'s `items={session.expenses.map(e => e.id)}` (line ~807) is a fresh array identity every render; `SortableExpenseCard` is not wrapped in `React.memo`; `onEdit`/`onDelete` handlers passed to each card are recreated every render (so `React.memo` alone wouldn't help without `useCallback` too). Each keystroke therefore re-runs `useSortable` once per expense card and reconciles every card, not just the form.

Needs triage — the fix (extracting `PaymentMethodEditor` and `ExpenseForm` into their own components, each owning its own state) is the same structural change ticket 18 (sessionpage-decomposition) proposes for maintainability reasons; these two tickets should be done together rather than separately; decomposition approach needs sign-off before starting since it touches most of the file.

Found by: best-practice-reviewer, holistic review (2026-08-28).
