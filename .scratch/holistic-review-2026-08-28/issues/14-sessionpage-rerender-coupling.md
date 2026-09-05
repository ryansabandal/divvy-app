Status: needs-triage
Severity: Low
Category: Performance

# Expense-form state living in the same component as the expense list causes a full re-render per keystroke

`SessionPage` holds 20 `useState` hooks across four unrelated concerns (add/edit expense form, payment-method editor, drag-and-drop, clipboard buttons) in one ~1000-line component. Because form state (`description`, `amount`, etc.) lives in the same component that renders the expense list, every keystroke in the description or amount field re-renders the entire list.

Location: app/[sessionId]/page.tsx:123-1042

Mechanism, not estimate: `SortableContext`'s `items={session.expenses.map(e => e.id)}` (line ~807) is a fresh array identity every render; `SortableExpenseCard` is not wrapped in `React.memo`; `onEdit`/`onDelete` handlers passed to each card are recreated every render (so `React.memo` alone wouldn't help without `useCallback` too). Each keystroke therefore re-runs `useSortable` once per expense card and reconciles every card, not just the form.

Needs triage — the fix (extracting `PaymentMethodEditor` and `ExpenseForm` into their own components, each owning its own state) is the same structural change ticket 18 (sessionpage-decomposition) proposes for maintainability reasons; these two tickets should be done together rather than separately; decomposition approach needs sign-off before starting since it touches most of the file.

Found by: best-practice-reviewer, holistic review (2026-08-28).

## Comments

**2026-09-05 — restored from `fix-on-touch`**, alongside h18/h15/qr-12/qr-13; see h18's comment
for the full reasoning (blanket demotion over-applied to cluster E's large, sign-off-required scope).

**2026-09-05 — no `React.memo`/`useCallback` needed to close this.** Once `ExpenseForm` is
extracted to own its form state (Slice 3 of `.scratch/plans/session-page-decomposition.md`), a
keystroke re-renders only `ExpenseForm` — a sibling `ExpenseList` is not re-rendered at all, because
React re-renders a component when its own state changes or its parent re-renders, never when a
sibling's state changes. Extraction closes this by construction; the ticket's mechanism paragraph
prescribing memo/`useCallback` on top would be unverifiable ceremony layered on a fix that's
already complete. Record this in the resolution note when the fix lands, so a reviewer doesn't
read the absence of memo/useCallback as an incomplete fix.
