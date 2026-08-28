Status: ready-for-agent
Severity: Low
Category: Best-Practice

# Epsilon and rounding sprawl — expands existing ticket 05, real scope is bigger than filed

Existing ticket `.scratch/v1-hardening-audit/issues/05-money-rounding-util.md` already flags repeated `Math.round(x*100)/100` and the 0.01 tolerance with no named constant or shared util. This review finds the sharpest instances that make the scope concrete:

- **Client and server disagree on the CUSTOM-split tolerance** — see ticket 06 in this batch (client-server-custom-split-tolerance-mismatch). Filed separately since it's an actual correctness bug, not just duplication, but the root cause is exactly this sprawl.
- **`components/ExpenseBreakdown.tsx:8` re-declares `CENT_EPSILON = 0.005`** with a comment saying it "mirrors the backend's RECONCILED_EPSILON." The mirroring is unnecessary: `lib/settle.ts` has no `server-only` guard and is already imported by `lib/expenseSplits.ts`, so a client component can import the constant directly instead of re-declaring it.
- `lib/settlementHelpers.ts:36` uses a bare `0.01` for plan-equality (this is ticket 01's stale-detection bug — the fix there removes this literal too).
- `app/[sessionId]/page.tsx:988` uses a bare `0.01` for the "remaining to split" highlight.
- **Misleading name:** `lib/expenseBreakdown.ts:41`'s rounding helper is named `toCents()` but returns *pesos* rounded to two decimals, not centavos. Ticket 05 already asks for a `roundToCents()` util — this is the naming half of that ask, made concrete.

Fix: one pass that (a) creates the `roundToCents()`/remainder-distribution util ticket 05 already scoped, (b) makes every one-off `0.005`/`0.01` literal import `RECONCILED_EPSILON` from `lib/settle.ts` instead of re-declaring or hardcoding it, and (c) renames `toCents()` to `roundToCents()`.

Found by: correctness-reviewer + best-practice-reviewer, holistic review (2026-08-28) — expanding existing ticket 05's scope, not superseding it.
