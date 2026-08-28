Status: ready-for-agent
Severity: High
Category: Correctness

# Stale-plan detection silently misses ~89% of one-centavo changes

`settlementPlansMatch()` compares amounts with `Math.abs(f.amount - l.amount) < 0.01`. Cent-valued doubles do not subtract to exactly `0.01`, so this comparison is wrong for the majority of one-centavo differences.

Verified independently (not just by the reviewing subagent): across 200,000 one-cent-apart amount pairs from ₱0.01 to ₱2000.00, **177,455 (88.7%) compare as "matching"** under this check. Example: `50.01 - 50 = 0.00999999999999801`, which is `< 0.01`, so a plan that actually changed by one centavo is reported as NOT stale.

This is the same bug class `RECONCILED_EPSILON = 0.005` (`lib/settle.ts`) was created to fix, reintroduced in a sibling module (`lib/settlementHelpers.ts`) that doesn't import it.

Location: lib/settlementHelpers.ts:36

Failure scenario: Alice pays ₱100.00, split EVEN across Alice+Bob, finalized (`Bob → Alice ₱50.00`). Edit the expense to ₱100.02 (or add a ₱0.02 expense). Live plan is now `Bob → Alice ₱50.01`. `GET .../settlements` returns `stale: false`. No `StalePlanBanner` on `/settle` or `/view`, while `SessionSummary` shows "Total bill ₱100.02" next to a settle row still reading ₱50.00 — a one-centavo silent discrepancy with no warning.

Fix: compare rounded cents instead of raw float subtraction — `Math.round(f.amount * 100) !== Math.round(l.amount * 100)` — which removes the float dependence entirely rather than swapping in a different epsilon.

Test gap: the only positive stale test (`tests/sessions.integration.test.ts:1383`) changes the plan by ₱10, nowhere near the boundary. The suite already knows the straddle-the-boundary technique (the CUSTOM-epsilon pair at lines 620/641 pins 0.0049 accepted / 0.0051 rejected) — it wasn't applied here. Add a case that changes a finalized plan by exactly one centavo and asserts `stale: true`.

Found by: correctness-reviewer, holistic review (2026-08-28); confirmed independently by Claude via a 200,000-case script before filing.
