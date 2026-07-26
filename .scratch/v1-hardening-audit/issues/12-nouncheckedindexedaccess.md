Status: resolved (2026-07-26) — enabled in `tsconfig.json`; fixed the 16 resulting errors across `lib/settle.ts` (non-null assertion, loop-guard-bounded), `lib/settlementHelpers.ts`, `lib/expenseSplits.ts` (×2), and `lib/requestBody.ts` (all three via guards/fallbacks, not assertions). 3-lens review fuzz-tested `settle.ts`'s assertion (200k cases, confirmed sound) and caught one inconsistency in `settlementHelpers.ts` (fixed to a guard, matching the other three sites).
Severity: Low
Category: Best-practice

# tsconfig strictness gap: noUncheckedIndexedAccess off

`tsconfig.json` has `strict: true` but not `noUncheckedIndexedAccess`. Code relies on unchecked index access in a few places (e.g. array-index reads in the settlement/split-building helpers under `lib/`). Now a single tsconfig instead of the old two (`backend/`'s + `frontend/`'s), so the fix is simpler than when this ticket was filed.

Fix sketch: enable the flag and fix the resulting type errors. Optional hardening, industry-trending default.
