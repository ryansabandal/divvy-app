Status: fix-on-touch (was: needs-triage)
Severity: Low
Category: Best-Practice

# `SessionPage` is a ~900-line component holding four unrelated concerns

`app/[sessionId]/page.tsx` (1042 lines, the largest file in the repo by 2x) holds 20 `useState` hooks spanning: the add/edit expense form, the payment-method editor (tabs, bank fields, QR upload/remove), drag-and-drop reordering, and two independent clipboard buttons. It has (at minimum) two Fowler-catalog Divergent Change axes in one file — a payment-method change and an expense-form change both require editing this same file.

Location: app/[sessionId]/page.tsx:123-1042

This is a maintainability finding on its own, and it also causes the performance issue in ticket 14 (sessionpage-rerender-coupling) — form keystrokes re-render the whole expense list because form state and list-rendering state live in the same component. The two tickets should be executed together: extracting `PaymentMethodEditor` and `ExpenseForm` into their own components (each owning its own state) fixes the re-render coupling and the file size in the same move, and gives the `ExpenseRow` extraction (ticket 15) a natural home to be wrapped inside.

Needs triage — this is the largest single change surfaced in the review and touches most of the file. Needs a decomposition plan (what components, what props, what stays in the parent) before starting, not a direct fix-sketch application.

Found by: best-practice-reviewer, holistic review (2026-08-28).
