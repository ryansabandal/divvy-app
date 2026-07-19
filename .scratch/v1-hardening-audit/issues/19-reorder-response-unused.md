Status: backlog (not blocking V1 close)
Severity: Low
Category: Efficiency

# Reorder route's response payload is built but never consumed

`PATCH /:sessionId/expenses` (the bulk-reorder route, sessions.ts:483) ends with a `findMany` + `.map(serializeExpense)` (sessions.ts:512-522) building the full reordered expense list to return. The frontend's `handleDragEnd` (frontend/app/[sessionId]/page.tsx) only checks `res.ok` and then calls a separate plain `mutate()` — the response body is never read.

Every drag-reorder does a real extra DB query and serialization pass server-side that the client immediately discards, then triggers a second round-trip (`mutate()`'s refetch) to get the same data back. Not incorrect, just wasted work on every reorder.

Location: backend/src/routes/sessions.ts:512-522 (the route's closing query + response) and frontend/app/[sessionId]/page.tsx (`handleDragEnd`, the `fetch(...)` for the reorder PATCH).

Fix sketch: either have the frontend consume the response directly via `mutate({...session, expenses: await res.json()}, {revalidate: false})` (dropping the extra `mutate()` refetch), or have the backend return `204 No Content` and let the frontend's existing `mutate()` be the only reconciliation. The latter is simpler and matches how `DELETE /:sessionId/expenses/:expenseId` already returns 204.

Found during: code review of commit 68b99ed (edit-expense + reorder feature), 2026-07-19.
