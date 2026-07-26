Status: resolved
Severity: Low
Category: Efficiency

# Reorder route's response payload is built but never consumed

`PATCH /:sessionId/expenses` (the bulk-reorder route, sessions.ts:483) ends with a `findMany` + `.map(serializeExpense)` (sessions.ts:512-522) building the full reordered expense list to return. The frontend's `handleDragEnd` (frontend/app/[sessionId]/page.tsx) only checks `res.ok` and then calls a separate plain `mutate()` — the response body is never read.

Every drag-reorder does a real extra DB query and serialization pass server-side that the client immediately discards, then triggers a second round-trip (`mutate()`'s refetch) to get the same data back. Not incorrect, just wasted work on every reorder.

Location: backend/src/routes/sessions.ts:512-522 (the route's closing query + response) and frontend/app/[sessionId]/page.tsx (`handleDragEnd`, the `fetch(...)` for the reorder PATCH).

Fix sketch: either have the frontend consume the response directly via `mutate({...session, expenses: await res.json()}, {revalidate: false})` (dropping the extra `mutate()` refetch), or have the backend return `204 No Content` and let the frontend's existing `mutate()` be the only reconciliation. The latter is simpler and matches how `DELETE /:sessionId/expenses/:expenseId` already returns 204.

Found during: code review of commit 68b99ed (edit-expense + reorder feature), 2026-07-19.

## Comments

Fixed 2026-07-26 (Phase 3 of the serverless migration, commit c3a8efd), via the simpler of the two sketched options: the bulk-reorder `PATCH` in `frontend/app/api/sessions/[sessionId]/expenses/route.ts` now returns `204 No Content` instead of re-fetching and re-serializing the full expense list, matching `DELETE .../expenses/:expenseId`'s existing pattern. Confirmed the frontend's `handleDragEnd` (`frontend/app/[sessionId]/page.tsx`) needed no change — it only ever checked `res.ok` and relied on its own follow-up `mutate()` refetch, never read the response body. The Phase 0 parity suite's reorder test was updated to expect `204` + no body, plus a follow-up GET to confirm the reorder took effect server-side (since the response itself no longer says so).
