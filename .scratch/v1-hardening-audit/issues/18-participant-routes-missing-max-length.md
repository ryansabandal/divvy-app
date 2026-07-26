Status: resolved
Severity: Low
Category: Security

# Participant routes have no max-length bound on name / payment_details

`POST /:sessionId/participants` (sessions.ts:207) and `PATCH /:sessionId/participants/:participantId` (sessions.ts:229) only check `typeof x === "string" && x.trim() !== ""` — unlike every Zod-validated route, which caps strings at 100-200 chars, there's no upper bound here.

A caller can `POST` a participant with a multi-hundred-KB `name`, or `PATCH` `payment_details` to a similarly huge string, repeated across many participants/sessions with no auth and (per already-tracked ticket 01) no rate limit — bounded in practice only by Express's ~100KB per-request body limit, still enough to inflate free-tier Postgres storage faster than equivalent abuse of the length-capped routes.

Adjacent to ticket 06 (which flags these same two routes' hand-rolled validation) but a distinct angle — 06's text is about type-safety/DRY (the `validTypes` re-declaration), not this specific missing size bound.

Location: backend/src/routes/sessions.ts:207-223 (POST) and :229-252 (PATCH).

Fix sketch: trivial once ticket 06 is picked up — add `.max(100)` (name) / `.max(200)` (payment_details) to whatever Zod schema replaces the hand-rolled checks. Do together with 06 rather than as a separate pass.

Found during: code review of commit 68b99ed (edit-expense + reorder feature), 2026-07-19.

## Comments

Fixed 2026-07-26 alongside ticket 06 (Phase 3 of the serverless migration, commit c3a8efd): `addParticipantSchema` caps `name` at 100 chars, `setPaymentMethodSchema` caps `payment_details` at 200 chars — same limits as the rest of `frontend/schemas/sessions.ts`. Verified: the Phase 0 parity suite's two tests that previously pinned "accepts arbitrarily long name/payment_details" as baseline behavior were updated to instead assert `400` for the same over-length inputs — the flip from pass to fail (on the old assertion) was the expected signal the fix landed, per the tests' own pre-existing comments.
