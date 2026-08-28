Status: needs-triage
Severity: Low
Category: Performance

# Bulk reorder issues one UPDATE per expense inside a single transaction

`prisma.$transaction(expense_ids.map((id, index) => prisma.expense.update({ where: { id }, data: { sort_order: index } })))` issues one round trip per expense, sequentially, holding the app's single pooled connection (`max: 1` in lib/db.ts) for the duration of the drag.

Location: app/api/sessions/[sessionId]/expenses/route.ts:95-99

Cost: a 15-expense session means 15 sequential Supabase round trips per drag-drop, all serialized on the one available connection.

Needs triage — the fix trades correctness-tool safety for speed: a single `UPDATE "Expense" SET sort_order = v.ord FROM (VALUES ...) v(id, ord) WHERE "Expense".id = v.id` via `$executeRaw` collapses this to one round trip, at the cost of hand-written SQL (no Prisma type-checking on the values, need to guard against SQL injection via parameterization even though ids are already UUID-validated upstream). Real tradeoff — flagged for a deliberate decision, not a drop-in fix.

Bound: the reorder cap (ticket 03 pushes this toward 50) limits the worst case to 50 sequential updates.

Found by: best-practice-reviewer, holistic review (2026-08-28).
