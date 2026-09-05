Status: fix-on-touch (was: ready-for-agent)
Severity: Low
Category: Correctness

# Participant PATCH and QR PUT/DELETE can 500 on P2025 when the retention job deletes the session

Ticket 27 applied `isMissingRowError()` to the settlement PATCH and left the participant and QR routes unguarded, on the stated reasoning that no delete path for a Participant exists. That reasoning is wrong.

Location: app/api/sessions/[sessionId]/participants/[participantId]/route.ts (PATCH), app/api/sessions/[sessionId]/participants/[participantId]/qr/route.ts (PUT, DELETE)

`prisma/schema.prisma` has `Participant.session ... onDelete: Cascade`, and the monthly pg_cron job runs `delete from "Session" where created_at < now() - interval '1 month'` (CLAUDE.md, "Data retention"). Participants **are** deleted — by that job, not by a route. The schema's own comment is precise about this ("no *route* deletes a Participant today"); ticket 27's note dropped the qualifier and generalised it to "nothing deletes a Participant", which is what let the gap through.

Failure scenario: at 03:00 UTC on the 1st, a participant has a month-old session open and saves a payment method or a QR code. The cron delete commits between the route's `findFirst` and its `prisma.participant.update()` → P2025 → uncaught → HTTP 500 with an HTML error page, where the expense and settlement routes return 404 for the identical interleaving.

Impact is genuinely negligible — a millisecond-wide window, once a month, only for month-old sessions, and not reproduced. It is filed because the inconsistency is the kind that gets reasoned about from a comment rather than from the schema: the false claim has been removed from `lib/prismaErrors.ts`, so the next reader has nothing to mislead them, but the three routes are still the odd ones out.

Fix: apply the existing `isMissingRowError()` helper to all three, returning each route's own not-found 404 — a direct copy of the settlement PATCH shape.

Found by: correctness-reviewer, 3-lens review of the tickets 27-34 slice (2026-08-30).
