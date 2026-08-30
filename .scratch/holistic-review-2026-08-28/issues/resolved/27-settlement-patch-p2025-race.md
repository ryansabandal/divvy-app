Status: resolved
Severity: High
Category: Correctness

# PATCH /settlements/:settlementId has the same P2025 race ticket 04 was meant to close

Ticket 04 added `isMissingRowError()` handling to the expense PATCH, expense DELETE, and the bulk
reorder transaction — but not to the settlement PATCH, which has the identical read-then-write shape
and a live delete path that makes the race real, not theoretical.

Location: app/api/sessions/[sessionId]/settlements/[settlementId]/route.ts (PATCH)

`POST /settlements` (re-finalize) runs `prisma.settlement.deleteMany({ where: { session_id } })` as
the first statement of its transaction, deleting every settlement row in the session before
recreating them. `PATCH /settlements/:settlementId` (mark-as-paid) does a `findFirst` then a
`prisma.settlement.update()` with no `try`/`catch`. Mark-as-paid and recalculate are two buttons on
the same settle screen, reachable by two different devices on the same session link at once — the
app's own trust model.

Failure scenario, reproduced: 150 attempts of a PATCH racing a re-finalize with a randomized 0-12ms
timing offset (firing them back-to-back does not open the window — 25/25 clean in an earlier,
unrandomized attempt) produced 200:17, 404:122, **500:11**. The thrown error was confirmed
`Prisma.PrismaClientKnownRequestError` with `code: "P2025"` — exactly what `isMissingRowError()`
already matches.

Fix: wrap the `prisma.settlement.update()` call in the same `try`/`catch` pattern as the other three
routes, returning 404 `"settlement not found in this session"` on `isMissingRowError(err)`.

Note: the participants PATCH and the QR PUT/DELETE routes share the same read-then-write shape but
have no route that deletes a Participant today, so they have no live race — `lib/prismaErrors.ts`'s
doc comment should be scoped to say so rather than implying universal coverage.

Found by: 3-lens Tier 1 review (2026-08-29), correctness + security + best-practice all flagged
variants of this; reproduced independently by the orchestrating session.

**2026-08-30 — fixed.** `prisma.settlement.update()` in `app/api/sessions/[sessionId]/settlements/[settlementId]/route.ts` now sits in the same `try`/`catch` the three expense routes use: `isMissingRowError(err)` → 404, anything else rethrown. Same `let updated` + assign-inside-`try` shape as the expense PATCH, so the four routes with this window now read identically.

The ticket's Note is done too: `lib/prismaErrors.ts`'s doc comment claimed *any* read-then-write route can lose its row. It now names the expense and settlement routes as the ones with a live delete path, and states that the participant and QR routes share the shape but have no such window because nothing deletes a Participant.

Not re-run: the 150-attempt randomized-offset race repro. The thrown error was already confirmed `P2025` by the prior session, and `isMissingRowError` is the same predicate already verified against real driver-adapter errors under ticket 04.
