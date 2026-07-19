Status: backlog (not blocking V1 close)
Severity: Medium
Category: Best-practice

# Inconsistent validation strategy: Zod in some routes, hand-rolled in others

POST /expenses and POST / use Zod schemas, but POST /participants (sessions.ts:125-127) and PATCH /participants/:id (sessions.ts:147-153) validate inline with typeof checks and a hardcoded validTypes = ["GCASH","MAYA","BANK_TRANSFER"] array that re-declares the Prisma PaymentMethodType enum.

Fix sketch: add addParticipantSchema / setPaymentMethodSchema to schemas/sessions.ts; derive the enum via z.nativeEnum(PaymentMethodType) so there's one source of truth.

Note: touches the same route as issue 01-duplicate-participant-ids (filed as in-scope, not here) — worth doing together if picked up.
