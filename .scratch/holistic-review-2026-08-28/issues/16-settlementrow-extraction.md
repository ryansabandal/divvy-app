Status: fix-on-touch (was: ready-for-agent)
Severity: Low
Category: Best-Practice

# `SettlementRow` duplication between settle and view — a second, unfiled lockstep hazard

`app/[sessionId]/settle/page.tsx:146-186` and `app/[sessionId]/view/page.tsx:123-150` render ~25 near-identical lines: the same card styling (`card flex flex-col gap-2 p-4`, `s.paid ? "border-teal/20 bg-teal/5"`), the same `from_name → to_name` span with identical `line-through` paid styling, the same `₱{s.amount.toFixed(2)}` formatting, the same `<PaymentAction>` call, and the same `<ExpenseBreakdown>` call with all four props identical. The only real difference is settle's `<label>` + checkbox wrapper for marking paid.

Location: app/[sessionId]/settle/page.tsx:146-186; app/[sessionId]/view/page.tsx:123-150

This is a separate extraction from `ExpenseRow` (ticket 15) but the same root cause and the same lockstep risk — the two should be planned together since they're likely to be worked in the same session, though they touch different components.

Fix sketch: extract a `SettlementRow` component parameterized by whether the paid-toggle control renders (settle) or not (view-only), same pattern the planned `ExpenseRow` uses for drag-and-drop wiring.

Found by: best-practice-reviewer, holistic review (2026-08-28).
