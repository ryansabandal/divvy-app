Status: backlog (not blocking V1 close)
Severity: Medium
Category: Best-practice

# POST and PATCH-edit expense routes duplicate session/paid_by validation

`POST /:sessionId/expenses` (sessions.ts:361) and `PATCH /:sessionId/expenses/:expenseId` (sessions.ts:411) each independently fetch the session with its participants, build `participantIdsInSession`, and validate `paid_by` against it — about 20 lines of identical setup before either one calls the shared `buildExpenseSplits()` helper.

The `buildExpenseSplits()` extraction (added alongside the edit route) correctly consolidated the risky rounding logic into one place, but the surrounding validation contract is still copy-pasted. If that contract ever changes — e.g. a future rule about who's allowed to be `paid_by` — it's easy to update one route and forget the other, letting add-expense and edit-expense silently diverge in what they accept.

Location: backend/src/routes/sessions.ts:361-383 (POST) and :411-437 (PATCH), specifically the session-fetch + `participantIdsInSession` + `paid_by` check in both.

Fix sketch: extract a small helper — e.g. `loadSessionAndValidatePayer(sessionId, paidBy)` returning either the session/participant-set or a 404/400 error — shared by both routes, mirroring how `buildExpenseSplits()` already unified the rounding logic.

Found during: code review of commit 68b99ed (edit-expense + reorder feature), 2026-07-19.
