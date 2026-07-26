Status: resolved
Severity: Low
Category: Best-practice

# Reorder route validates with hand-rolled checks instead of Zod, extending ticket 06's pattern

`PATCH /:sessionId/expenses` (the bulk-reorder route, sessions.ts:483) validates `expense_ids` with inline `Array.isArray`/`typeof` checks (sessions.ts:485-487) instead of a Zod schema, even though this same file models the Zod convention one route above via `createExpenseSchema`.

Not a new class of problem — ticket 06 already flags `POST`/`PATCH .../participants*` for the same Zod-vs-hand-rolled inconsistency — but worth a fresh mention since it shows the pattern spreading into brand-new code rather than staying confined to the two routes ticket 06 already named. Picking up 06 and this together would resolve both in one pass.

Location: backend/src/routes/sessions.ts:483-490 (`PATCH /:sessionId/expenses`).

Fix sketch: add a small Zod schema (e.g. `reorderExpensesSchema = z.object({ expense_ids: z.array(z.string()).max(50) })`) to `schemas/sessions.ts`, alongside `createSessionSchema`/`createExpenseSchema`. Do together with ticket 06 rather than separately.

Found during: code review of commit 68b99ed (edit-expense + reorder feature), 2026-07-19.

## Comments

Fixed 2026-07-26 (Phase 3 of the serverless migration, commit c3a8efd), exactly as sketched: added `reorderExpensesSchema = z.object({ expense_ids: z.array(z.string()).max(50) })` to `frontend/schemas/sessions.ts`, used via `safeParse` in the bulk-reorder `PATCH` handler in `frontend/app/api/sessions/[sessionId]/expenses/route.ts`. Also resolves tickets 20 (implicit `any`) and 21 (unguarded destructure) as the same fix sketch predicted. Verified: 80/80 on the Phase 0 parity suite.
