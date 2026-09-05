Status: resolved
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

## Comments

**2026-09-05 — fixed, decided against `orderBy: {id: "asc"}`.** This was blocked on a shared
decision with h09 (`.scratch/BACKLOG.md` cluster B) since h09 switches POST to
`createManyAndReturn`, whose insertion order needed to match GET's `orderBy` or this exact test
stays order-dependent. User chose (offered both options): add `sort_order Int
@default(autoincrement())` to `Settlement`, matching the existing `Participant.sort_order`/
`Expense.sort_order` pattern, over the simpler arbitrary-UUID `orderBy: {id: "asc"}`. Migration
`20260905015358_settlement_sort_order` (`ALTER TABLE "Settlement" ADD COLUMN "sort_order" SERIAL
NOT NULL`), applied locally. **Not yet applied to production** — per CLAUDE.md's deployment
notes, Vercel never runs `migrate deploy`; this needs a hand-run against the port-5432 session-mode
connection string before the next deploy that ships this route change.

Both `findMany` calls now carry `orderBy: { sort_order: "asc" }`. POST's `createManyAndReturn`
result is also explicitly re-sorted by `sort_order` before use, rather than trusting the DB's
`RETURNING` row order — the same "don't leave order unspecified" principle this ticket exists for.

**Verified by execution, not reasoning** — the exact failure scenario in this ticket's own text:
built a 3-participant session (2 settlement rows), froze the plan, recorded GET's row-id order,
`PATCH`'d the second row's `paid` flag, re-`GET`'d, and confirmed the id order was identical
before and after the UPDATE. `npm run test:integration` — 99/99, including the order-dependent
assertion this ticket named (now genuinely order-guaranteed, not incidentally passing).
