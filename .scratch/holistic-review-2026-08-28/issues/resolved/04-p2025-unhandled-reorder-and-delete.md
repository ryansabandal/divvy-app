Status: resolved
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

## Comments

**2026-08-29 — fixed.** Extracted the expense-PATCH catch into `lib/prismaErrors.ts` `isMissingRowError(err)` and applied it to all three routes with the shape.

**Named fork — the two routes get different status codes, on purpose:**
- expense `PATCH` and `DELETE` → **404** "expense not found in this session", matching each route's own `findFirst` miss two lines above. A raw 500 there was the same outcome reported two different ways.
- bulk reorder → **400**, reusing the route's existing "expense_ids must include every expense in this session exactly once". A concurrent delete makes the caller's *list* stale, which is a bad request, not a missing resource — and the message already describes exactly that.

The helper returns a boolean rather than a ready-made `NextResponse` precisely because of that fork; a helper that picked the status would have forced one of the two call sites to be wrong.

Verified against real driver-adapter errors, not a hand-built object: P2025 matched, and P2003 (FK violation) correctly fell through to be rethrown — the predicate isn't just swallowing every Prisma error.

Test gap from the ticket (two concurrent DELETEs; a reorder concurrency case) is still open — step 9.
