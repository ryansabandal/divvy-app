Status: resolved
Severity: Low
Category: Security

# Reorder route destructures req.body without checking it's an object first

`const { expense_ids } = req.body;` (sessions.ts:485) doesn't guard against `req.body` being `undefined` — if a request arrives with a non-JSON `Content-Type`, `express.json()` never populates `req.body`, and this destructure throws synchronously.

Express 5 forwards that throw to the generic error handler (backend/src/index.ts), which — per already-tracked ticket 02 — leaks the raw JS error message (e.g. "Cannot destructure property 'expense_ids' of undefined", revealing internal variable names) to the client whenever `NODE_ENV` isn't literally `"production"`. Not a new vulnerability class, just one more trigger for ticket 02's already-known gap.

Location: backend/src/routes/sessions.ts:485.

Fix sketch: resolved as a side effect of ticket 17's Zod schema (`safeParse` on `req.body` handles a missing/malformed body cleanly via its own 400, same pattern `createExpenseSchema.safeParse` already uses elsewhere) — no separate fix needed if 17 is picked up. Otherwise, closing ticket 02 itself (fixing `NODE_ENV`-dependent disclosure) is the higher-leverage fix, since this same unguarded-destructure shape likely exists elsewhere too.

Found during: code review of commit 68b99ed (edit-expense + reorder feature), 2026-07-19.

## Comments

Resolved as a side effect of ticket 17's fix (2026-07-26, commit c3a8efd): the bulk-reorder handler now calls `parseBody(request, reorderExpensesSchema)`, which internally does `safeParse` and returns a clean 400 for any malformed/missing body instead of a raw destructure — same pattern as every other Zod-validated route. Also moot as a *class* of bug in the new architecture: `frontend/lib/requestBody.ts`'s `parseJsonBody()` handles the empty/malformed-body case uniformly for every route, not just this one, and Next.js Route Handlers have no `NODE_ENV`-dependent disclosure path for an uncaught throw to leak through even if one occurred (see ticket 02).
