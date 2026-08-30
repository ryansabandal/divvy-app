Status: backlog (not blocking V1 close)
Severity: Medium
Category: Best-practice

# Repeated money-rounding logic and magic epsilon, no money util

Math.round(x * 100) / 100 and the 0.01 tolerance appear repeatedly: settle.ts:33,41,42, sessions.ts:210,215,217,227,253,258,260, and both frontend forms. The remainder-distribution block is copy-pasted almost identically between the EVEN branch (sessions.ts:213-218) and QUANTITY branch (sessions.ts:256-261).

Fix sketch: a roundToCents() helper + named CENT_EPSILON constant, and factor remainder-distribution into one function. (Money-as-Float vs centavos/Decimal stays a separate, already-documented V2 decision — see CHANGELOG.md "Considered but intentionally not scheduled.")

## Comments

**2026-08-28, holistic review:** scope confirmed and found bigger than originally filed. See `.scratch/holistic-review-2026-08-28/issues/17-money-util-epsilon-sprawl.md` for the expanded instance list — notably a real client/server tolerance mismatch bug (ticket 06 in that batch, not just duplication), `ExpenseBreakdown.tsx`'s gratuitous re-declaration of `CENT_EPSILON` instead of importing it, and `toCents()`'s misleading name (returns pesos, not centavos). This ticket's original scope and fix sketch still stand; treat 17 as the up-to-date superset when implementing.

**2026-08-30, partially done.** The "factor remainder-distribution into one function" half is complete: `lib/money.ts` `distributeCents()` now serves both the EVEN and QUANTITY branches, replacing the two copy-pasted blocks this ticket named. Landed under holistic-review ticket 07, which needed the same function anyway.

Still open here: the `roundToCents()` helper and the epsilon literals. Deliberately not shipped with 07 — after that fix `lib/expenseSplits.ts` has no `Math.round(x * 100) / 100` left, so `roundToCents()` would have landed as an unused export. It goes in the ticket 17 pass, where its call sites (`lib/expenseBreakdown.ts`'s misnamed `toCents()`, `components/ExpenseBreakdown.tsx`'s re-declared `CENT_EPSILON`) change in the same commit.
