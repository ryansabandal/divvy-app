Status: resolved
Severity: Medium
Category: Best-practice

# Inconsistent validation strategy: Zod in some routes, hand-rolled in others

POST /expenses and POST / use Zod schemas, but POST /participants (sessions.ts:125-127) and PATCH /participants/:id (sessions.ts:147-153) validate inline with typeof checks and a hardcoded validTypes = ["GCASH","MAYA","BANK_TRANSFER"] array that re-declares the Prisma PaymentMethodType enum.

Fix sketch: add addParticipantSchema / setPaymentMethodSchema to schemas/sessions.ts; derive the enum via z.nativeEnum(PaymentMethodType) so there's one source of truth.

Note: touches the same route as issue 01-duplicate-participant-ids (filed as in-scope, not here) — worth doing together if picked up.

## Comments

Fixed 2026-07-26 (Phase 3 of the serverless migration, commit c3a8efd), folded in alongside ticket 18: added `addParticipantSchema`/`setPaymentMethodSchema` to `frontend/schemas/sessions.ts` exactly as sketched, using `z.nativeEnum(PaymentMethodType)` imported from `@prisma/client` in place of the hand-rolled `validTypes` array. `frontend/app/api/sessions/[sessionId]/participants/route.ts` (POST) and `.../participants/[participantId]/route.ts` (PATCH) now `safeParse` against them via a shared `parseBody()` helper. Verified: the Phase 0 parity suite's two participant tests that pinned the old no-cap behavior were updated to expect `400` and now pass against the new max-length caps (100 chars for name, 200 for payment_details) — 80/80 overall.
