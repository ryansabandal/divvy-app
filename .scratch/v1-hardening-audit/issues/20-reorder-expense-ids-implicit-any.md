Status: backlog (not blocking V1 close)
Severity: Low
Category: Type-safety

# expense_ids is implicitly typed any in the reorder route

`const { expense_ids } = req.body;` (sessions.ts:485) destructures from `req.body`, which Express types as `any` — so `expense_ids` is implicitly `any` for the rest of the handler, even though later code manually annotates it (`expense_ids.map((id: string, index: number) => ...)`, sessions.ts:520).

Cosmetic on its own, but it's the same root cause as ticket 17 (hand-rolled validation instead of Zod) — fixing that with a proper Zod schema would resolve this too, rather than needing a separate fix.

Location: backend/src/routes/sessions.ts:485 and :520.

Fix sketch: resolved as a side effect of ticket 17's Zod schema — `reorderExpensesSchema.parse(req.body).expense_ids` would be properly typed as `string[]`, removing the need for the manual `(id: string, index: number)` annotations entirely.

Found during: code review of commit 68b99ed (edit-expense + reorder feature), 2026-07-19.
