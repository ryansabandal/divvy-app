Status: ready-for-agent
Severity: Low
Category: Correctness

# Frozen settlements are returned with no `orderBy`

Both `prisma.settlement.findMany` calls in the settlements route omit `orderBy` — the only unordered list query in the app. Every other list query is explicitly ordered (`sort_order` on participants/expenses), and `prisma/schema.prisma` documents this exact hazard by name in its own comments ("an UPDATE ... can otherwise make Postgres return rows in a different physical order than before").

Location: app/api/sessions/[sessionId]/settlements/route.ts:31, :97

Failure scenario (plausible, not proven without a live Postgres): a 3-row frozen plan. User checks "paid" on row 2 → `PATCH` → client `mutate()`s → re-`GET`. The updated row's tuple can come back in a different position after the UPDATE, visibly reshuffling the settle-screen list under the user's finger.

Confirmed by reading (not dependent on Postgres internals): the suite already has an assertion resting on this unspecified order — tests/sessions.integration.test.ts:1341 asserts `body.settlements[0].id === frozen.body.settlements[0].id` (POST-response order matching GET order). It only passes because the fixture used (`createSessionWithADebt`) yields exactly one settlement row; adding a second creditor/debtor pair would make the assertion order-dependent and potentially flaky.

Scope note: `settlementPlansMatch()` sorts by key before comparing and `SettlementProgress` only sums, so both are order-immune — the consequence is display order plus that one brittle test.

Fix: add a stable `orderBy` (e.g. by `id`, or by the settlement's own creation order) to both `findMany` calls.

Found by: correctness-reviewer, holistic review (2026-08-28).
