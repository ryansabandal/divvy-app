Status: ready-for-agent
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
