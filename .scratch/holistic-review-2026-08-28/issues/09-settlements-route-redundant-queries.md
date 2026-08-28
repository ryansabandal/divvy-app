Status: ready-for-agent
Severity: Low
Category: Performance

# `settlements` route re-fetches participant names it already holds

**GET** (lines 31-34): `prisma.settlement.findMany({ include: { debtor: true, creditor: true } })` — but `serializeSettlement` only reads `debtor.name`/`creditor.name`, and `session.participants` (fetched a few lines earlier at :19-25) already has every name. Two redundant relation queries per request.

**POST** (lines 97-100): after the `$transaction` that writes the new plan, a *third* query re-reads the same rows purely because `createMany` doesn't return created rows — again with both relation includes.

Location: app/api/sessions/[sessionId]/settlements/route.ts:31-34, :97-100

Cost: ~2-3 redundant round trips per finalize/recalculate/view, serialized on the app's `max: 1` Prisma pool (lib/db.ts).

Fix: build a `Map` from `session.participants` (already loaded) for names in GET, dropping the `include`. For POST, use `createManyAndReturn` (available in the generated Prisma 7 client) to get the created rows with ids in one call, then attach names from the same `participants` map — no third query.

**Response shape is completely unchanged by this fix — no test churn, no API contract change.** Cleanest win identified in the review.

Found by: best-practice-reviewer, holistic review (2026-08-28).
