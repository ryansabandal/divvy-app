Status: resolved
Severity: Medium
Category: Correctness

# Edit route can 500 instead of 404 if the expense is deleted mid-request

`PATCH /:sessionId/expenses/:expenseId` (backend/src/routes/sessions.ts:410) checks the expense exists via `findFirst` (line 429), then later runs a `$transaction` (line 447) that deletes its splits and updates the row. Those two steps aren't atomic with each other, so a `DELETE` for the same expense landing in between turns a clean 404 into an unhandled 500.

Failure scenario: two participants on the same shared link — one starts editing an expense while the other deletes it. If the `DELETE` completes after this route's existence check but before its `$transaction` runs, `expenseSplit.deleteMany` silently no-ops (0 rows matched) but the following `prisma.expense.update` targets a row that's gone, which Prisma throws as `P2025` for. Nothing catches it, so it falls through to the generic error handler (backend/src/index.ts) as a 500 — leaking the raw Prisma error message when `NODE_ENV` isn't set (compounding already-tracked ticket 02) — instead of the same clean "expense not found in this session" 404 every other route in this file achieves via the identical existence-check pattern. Narrow timing window, but two people editing the same session concurrently is normal usage for this app, not a contrived edge case.

Location: backend/src/routes/sessions.ts:429-461 (`PATCH /:sessionId/expenses/:expenseId`, between the `existing` check and the `$transaction`).

Fix sketch: wrap the `$transaction` call in a try/catch, check for Prisma's `P2025` (record not found) specifically, and return the same 404 the existence check already returns on that path — matching how this file already handles every other "row vanished" case.

Found during: code review of commit 68b99ed (edit-expense + reorder feature), 2026-07-19. Verified against source before filing, not just an agent's claim.

## Comments

Fixed 2026-07-19: the `$transaction` in `PATCH /:sessionId/expenses/:expenseId` (backend/src/routes/sessions.ts) is now wrapped in try/catch, checking `err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025"` and returning the same 404 the existence check above already returns.

Verified, not assumed: wrote a throwaway script using the app's own `prisma` client to create an expense, delete it, then run the exact same `$transaction` shape against the deleted id — confirmed Prisma actually throws `PrismaClientKnownRequestError` with `code: "P2025"` and that `instanceof Prisma.PrismaClientKnownRequestError` is `true`, i.e. the catch condition matches reality, not just an assumption from docs. Also confirmed over real HTTP that the normal edit path still returns 200 and the pre-existing "outright nonexistent id" 404 path is unaffected. `tsc --noEmit` clean, 8/8 tests passing.

Note: did not force the literal concurrent-request race end-to-end over HTTP (attempted one best-effort simultaneous DELETE+PATCH firing; it happened not to land in the vulnerable window that time — timing races aren't reliably reproducible without injecting an artificial delay into the route, which wasn't worth doing for this). The direct Prisma-error-shape verification above is what actually proves the fix's logic is correct; the HTTP attempt was a bonus check, not the primary evidence.
