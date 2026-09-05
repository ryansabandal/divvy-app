Status: resolved
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

## Comments

**2026-09-05 — fixed, alongside h08** (same commit — both rewrite the same two `findMany`/
`createMany` calls, and h09's `createManyAndReturn` switch is what made h08's shared ordering
decision live in the first place; see that ticket's note for the `sort_order` migration).

GET: dropped the `include: { debtor: true, creditor: true }`; names now come from a
`participantsById` map built off `session.participants`, which was already loaded a few lines
above — exactly as filed. POST: replaced `createMany` + a third `findMany` re-read with
`createManyAndReturn` inside the same `$transaction` array, then attached names from the same
map. No third query.

**Response shape is unchanged, confirmed by execution, not just by reading the diff:**
`npm run test:integration` — 99/99, no assertion changes needed anywhere in the suite. Manually
verified the freeze response has real `from_name`/`to_name` values (not `undefined`) with a
3-participant, 2-settlement-row session.
