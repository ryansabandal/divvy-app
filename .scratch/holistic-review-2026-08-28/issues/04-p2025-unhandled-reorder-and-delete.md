Status: ready-for-agent
Severity: Medium
Category: Correctness

# The P2025 concurrent-delete fix (ticket 15) landed on only one of three routes with the same shape

Resolved ticket `15-edit-route-toctou-500-instead-of-404.md` fixed the check-then-write TOCTOU race in expense PATCH: catch Prisma's P2025 (row vanished between the existence check and the write) and return a clean 404 instead of an unhandled 500. Two sibling routes have the identical `findFirst`/`findUnique`-then-write shape but no such handling.

**a. Bulk reorder** — app/api/sessions/[sessionId]/expenses/route.ts:72-99. Reads `session.expenses` via `findUnique`, then runs `$transaction(expense_ids.map(id => prisma.expense.update({ where: { id }, ... })))` with no `try`/`catch`.

Scenario: two people on the same session link (the app's own trust model) — A drag-reorders a 3-expense list and PATCHes all three ids; B deletes expense #2 in the window between A's `findUnique` and the transaction. The vanished row's `update` throws P2025, unhandled → raw 500. The transaction rolls back (no partial write), but the response is exactly the class of bug ticket 15 was meant to eliminate everywhere.

**b. Expense delete** — app/api/sessions/[sessionId]/expenses/[expenseId]/route.ts:91-99. `findFirst` then `prisma.expense.delete({ where: { id } })`, no `try`/`catch`.

Scenario: the same expense deleted from two devices at once (the `deletingExpenseId` UI-disable only guards the initiating client). The losing request's `delete` throws P2025 → 500, where the route's own `findFirst` miss two lines above already returns a clean 404 for the identical "not found" case.

Fix: extract the P2025 catch-and-404 pattern already present in the expense PATCH route into a small shared helper, and apply it to both routes above.

Test gap: the concurrency test at tests/sessions.integration.test.ts:1055 covers a PATCH+DELETE pair (asserting the DELETE path returns 204) but never fires two DELETEs against the same expense, and there is no concurrency test at all for the reorder route. Add both.

Found by: correctness-reviewer, holistic review (2026-08-28).
