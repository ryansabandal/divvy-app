Status: fix-on-touch (was: ready-for-agent)
Severity: Medium
Category: Best-Practice

# Test suite: imprecise assertions and missing negative cases

The suite is generally strong (session-scoped isolation, exact key-set shape locks, malformed-id 404 coverage on every route, deliberate boundary-straddling elsewhere). CLAUDE.md states the highest-value review is the one on the test suite itself, since wrong assertions turn every later phase into false confidence — these are the places that would currently pass on broken code:

**1. `toBeCloseTo(x, 2)` on remainder assertions.** tests/sessions.integration.test.ts:504-507, :788-791 — Vitest's `toBeCloseTo(x, 2)` passes for anything within 0.005 of the expected value. These tests exist specifically to prove "the shares add up to precisely 100, with no dropped or invented centavo" (per the test's own comment at :502-503), but as written they'd pass on an implementation leaking up to half a centavo per row — including the negative-share bug in ticket 07. Fix: use exact `toBe` once ticket 07's centavo-distribution fix lands and the new exact expected values are known.

**2. A real contradiction hidden by an under-specified assertion.** Line 1375, `"returns an empty settlements array when balances already net to zero"`, asserts only `body.settlements === []`. It passes over: `POST` returns `frozen: true` while `createMany` persisted zero rows, so the next `GET` sees `frozen.length === 0` and reports `frozen: false` — a plan that was just "finalized" immediately reports itself as not finalized. Unreachable from the current UI (the Finalize button is hidden when there are no settlements), so this is a test-coverage gap rather than a user-facing bug on its own — but it's exactly the kind of drift a stronger assertion would have caught. Fix: assert the round-trip (`POST` then `GET`) agrees on `frozen`, or explicitly document the known inconsistency if it's accepted.

**3. Order-dependent assertion.** Line 1341 asserts `body.settlements[0].id === frozen.body.settlements[0].id`, resting on the unordered `findMany` calls ticket 08 (settlements-findmany-no-orderby) flags. Passes today only because the fixture yields exactly one row. Fix: either add explicit sorting before comparing, or fix ticket 08 first and this becomes moot.

**4. Missing negative/boundary cases**, none currently covered: malformed (non-empty) JSON body on any route (ticket 05); the stale-detection boundary at exactly one centavo (ticket 01); the reorder route at/over the 50-expense cap (ticket 03); a second concurrent DELETE on the same expense (ticket 04, part b).

**5. QR Storage test cleanup is not exception-safe.** Lines 1671, 1699, 1725 (and siblings) place `await api(.../qr, { method: "DELETE" })` as the **last statement of the test body**, not in `afterEach`/`finally`. A failing assertion above it skips cleanup and leaves a real object in the (production-adjacent) Storage bucket permanently — nothing else reclaims it (see ticket 24, orphaned QR storage). Fix: move QR cleanup into `afterEach` for any test that uploads one.

**6. Minor inconsistency:** `createEvenExpense` (line 868) is `describe`-scoped while sibling helpers (`createSession`, `createSessionWithParticipants`, `createSessionWithADebt`, `uploadQrForParticipant`) are module-scoped, for no apparent reason. Low priority.

Fix each item alongside the corresponding code fix (01, 03, 04, 05, 07, 08) rather than as a separate pass, except items 5 and 6 which stand alone.

Found by: correctness-reviewer + best-practice-reviewer, holistic review (2026-08-28).

## Comments

**2026-08-30 — item 1 done**, alongside ticket 07's fix. `tests/sessions.integration.test.ts:504-507` and `:788-791` are now exact `toBe(100)` / `toBe(33.34)` / `toBe(33.33)`. The EVEN block's comment claiming the exact distribution was "an implementation detail" is gone — it is pinned now, which is the point of the item.

Caveat worth carrying to any future precision assertion: `distributeCents()` guarantees the sum is exact **in centavos**, but these tests sum **pesos**. `33.34 + 33.33 + 33.33` happens to be exactly `100` in IEEE754, which is why `toBe` is safe here; the 18-way ₱1.00 split sums to `1.0000000000000004`. Check the specific addition before pinning a total exactly, or round first.

**Remaining items, sorted by whether they are doable today:**
- **Items 4, 5, 6 — doable now.** Item 4's pairings (tickets 01, 03, 04, 05) are all resolved, so those negative/boundary cases are writable; the exception is the reorder-route-at-cap case, which pairs with still-open ticket 36. Items 5 and 6 always stood alone. Item 5 is the one with real consequences — a failing assertion above the trailing QR `DELETE` leaves an object in the production-adjacent Storage bucket permanently, and ticket 24 says nothing reclaims it.
- **Items 2 and 3 — blocked on ticket 08.** Item 3 says so outright ("fix ticket 08 first and this becomes moot"), and item 2's `frozen` round-trip contradiction lives in the same route. Both ride with the 08 + 09 settlements slice, which is still waiting on the `orderBy` decision — the `Settlement` model has no `created_at` or `sort_order`, so it is either `orderBy: { id: "asc" }` (arbitrary, and POST must sort identically) or a migration adding a column.

**2026-09-05 — item 3 now moot.** h08/h09 shipped: `Settlement` gained a `sort_order` column, both `findMany` calls are explicitly ordered by it, and this exact scenario was verified by execution (2-row plan, mark one paid, GET order unchanged before/after). No test edit needed — the assertion this item worried about is now genuinely order-guaranteed rather than incidentally passing.

Item 2 is still open, deliberately not folded into that fix: it's a real behavior question (should `POST` report `frozen: true` when the computed plan is empty and nothing was persisted?), not a mechanical ordering/query change, and wasn't part of what was asked for in that pass. Still `fix-on-touch` — next touch of this route is the moment to raise it.
