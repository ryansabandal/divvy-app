Status: resolved
Severity: Low
Category: Correctness

# Remainder push in EVEN/QUANTITY splits can produce a negative `amount_owed`

`buildExpenseSplits()` computes each person's rounded share, then dumps the *entire* accumulated rounding remainder onto `splitRows[0]`. When per-person rounding is upward for most rows, the remainder pushed onto row 0 can exceed that person's whole share, going negative.

Location: lib/expenseSplits.ts:40-45 (EVEN), :99-104 (QUANTITY)

Verified by exhaustive scan: EVEN split of ₱1.00 across 18 participants gives person #1 **−₱0.02** while the other 17 each pay ₱0.06 — sum still reconciles to ₱1.00 exactly (which is what hides it), but the expense card and breakdown panel would render "₱-0.02" for that person, i.e. they'd appear *credited* for an expense they shared. QUANTITY hits harder: 20 units of a ₱1.70 expense pushes −₱0.10 onto person #1.

Reachability bound: triggerable only when `amount < 0.005 · N · (N−1)` — about ₱12.25 at the 50-participant cap, or under ₱0.15 at a realistic 6 people. Effectively unreachable for real bills, hence Low severity — but worth fixing since the correct fix is not meaningfully harder than the current one.

**Fix must distribute the remainder across participants, not clamp it.** Clamping the negative row at zero would break the sum invariant `computeNetBalances` depends on (the split total would then exceed the expense amount) — trading an unreachable cosmetic bug for a reachable reconciliation error. Instead, hand out the leftover whole centavos one at a time across participants (e.g. compute in integer cents: `base = floor(totalCents / n)`, distribute `totalCents - base*n` extra cents to the first that-many participants) so no row moves by more than one centavo from the base share and the total lands exactly on `amount`. Same shape applies to the QUANTITY branch.

Verified numerically before filing: across n=1..50 × amount=₱0.01..₱30.00 (150,000 cases), the centavo-distribution approach produces zero negative rows and zero inexact sums; EVEN ₱1.00/18 → all rows ₱0.05–₱0.06 summing to exactly ₱1.00; the common case (₱100/3) is unchanged from today's output (33.34, 33.33, 33.33), so this doesn't churn existing expected test values for typical splits.

Test-suite note: the existing remainder assertions (tests/sessions.integration.test.ts:504-507, 788-791) use `toBeCloseTo(x, 2)`, which passes for any value within 0.005 of the expected — including a leaking negative share. Convert to exact `toBe` once the new exact values are known, so these tests actually test the "no dropped or invented centavo" claim their own comments make. Do the distribution fix first, then pin the new exact values, to avoid rewriting the assertions twice.

Found by: correctness-reviewer, holistic review (2026-08-28); centavo-distribution approach verified independently by Claude via a 150,000-case script before filing.

## Comments

**2026-08-30 — fixed.** New `lib/money.ts` exports `distributeCents(totalCents, weights)`, and both branches of `buildExpenseSplits()` call it. The two character-identical remainder-push blocks are gone, and with them every `Math.round(x * 100) / 100` in `lib/expenseSplits.ts`.

**The ticket's "same shape applies to the QUANTITY branch" was wrong, and following it would have left the bug half-fixed.** The prescribed `base = floor(totalCents / n)` + "extra cents to the first that-many" only works because every EVEN share is equal. QUANTITY shares are proportional to units consumed, so it needs largest-remainder (Hamilton) apportionment: floor each exact share, then hand the leftover centavos to the entries that lost the most to that floor, ties going to the earlier participant. Writing it that way makes EVEN the special case where all weights are 1 — one function instead of two, which is also what `v1-hardening-audit/05` means by "factor remainder-distribution into one function."

All integer arithmetic, including the shortfall ranking (`(totalCents * w) % totalWeight` rather than a float fraction), so the ranking never sees float noise.

**The ticket's line numbers were stale** — the real targets were `:35-45` (EVEN) and `:90-104` (QUANTITY), not `:40-45`/`:99-104`.

Verified through `buildExpenseSplits()` itself, not just the helper:
- EVEN ₱1.00 / 18 → ten rows at ₱0.06, eight at ₱0.05 (was **−₱0.02** on person #1)
- QUANTITY ₱1.70 / 20 units → ten at ₱0.09, ten at ₱0.08 (was **−₱0.10** on person #1)
- EVEN and QUANTITY ₱100 / 3 → 33.34 / 33.33 / 33.33, unchanged

**The ticket's 150,000-case sweep covered EVEN only.** `lib/money.test.ts` now runs a 45,000-case sweep over equal weights *and* two lopsided weight shapes, asserting no negative share and an exact centavo sum — under `npm test`, so it needs no dev server. That, not the one-off script, is what makes the invariant standing.

Test-suite note done as well (ticket 23 item 1): the remainder assertions at `tests/sessions.integration.test.ts:504-507` and `:788-791` are now exact `toBe`. `33.34 + 33.33 + 33.33` was checked to be exactly `100` in IEEE754 before pinning the total — the centavo sum is always exact, but a peso sum is not guaranteed to be (the 18-way split sums to `1.0000000000000004`), so an exact assertion on a total is only safe where the specific addition is.

**2026-08-30 — 3-lens reviewed, findings applied.** Correctness verified the fix is sound: it proved the integer-exactness claim properly (the correctly-rounded quotient cannot cross an integer boundary while `totalCents * w <= 2^53`), then confirmed it against BigInt truth over 500,000+ cases; confirmed `leftover` is bounded to `[0, weights.length)`; confirmed the exact `toBe` assertions are not flaky; and confirmed both `?? 0` fallbacks are unreachable (`cents.length === weights.length` by construction on both return paths).

**The one real gap, found independently by two lenses:** the test named "spreads the leftover centavos across unequal weights too" passed `Array(20).fill(1)` — twenty *equal* weights. Weight-proportionality, the entire reason this helper exists rather than the ticket's prescribed equal-share recipe, was pinned only by a two-element `[1, 3]` case. Correctness demonstrated the cost concretely: a mutant `distributeCents` that **ignores `weights` entirely** passed the 100/3 test, the 18-way test, the mis-named "unequal weights" test, and the whole 45,000-case sweep — the sweep asserts only non-negativity and exact sum, which any equal-split implementation satisfies.

Fixed by adding a genuinely lopsided case (`distributeCents(170, [7, 6, 4, 3])` → `[60, 51, 34, 25]`, which also pins the tie-break inside a weighted split) and correcting every test title to describe what its body asserts. Re-ran the same mutant afterwards: it now fails two tests instead of one.

Also applied: the `totalWeight <= 0` guard contradicted this helper's own documented sum invariant, so the docstring now states the invariant's precondition instead of overclaiming; `buildExpenseSplits()`'s doc comment no longer claims to own rounding and remainder distribution (both moved to `lib/money.ts`); five stale references to the deleted "remainder-push" across `tests/sessions.integration.test.ts` and `lib/settle.test.ts` are gone, as are two comments of mine that broke CLAUDE.md's comment rule by carrying rationale and before/after narrative rather than saying what the code does; and `README.md:214`/`:228` no longer document the removed algorithm.

**One High-severity finding was filed separately rather than folded in — see ticket 38.** `amount` has no upper bound, so it overflows to `Infinity` and corrupts the settlement plan. Pre-existing, different root cause (`schemas/sessions.ts`), and it needs its own reviewable diff.

Verified after all edits: `npx tsc --noEmit` clean · `npm run lint` 0 errors (1 pre-existing warning) · `npm test` 23/23 · `npm run test:integration` 95/95.
