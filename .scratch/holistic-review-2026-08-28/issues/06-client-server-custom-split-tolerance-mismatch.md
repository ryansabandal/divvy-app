Status: ready-for-agent
Severity: Medium
Category: Correctness

# Client and server disagree on the CUSTOM-split reconciliation tolerance

The client's CUSTOM-split inline validation rejects when `Math.abs(sum - amountNum) > 0.01`; the server (`buildExpenseSplits`) rejects when `> RECONCILED_EPSILON` (0.005). The client's own comment says it's meant to mirror the backend rule — it doesn't.

Location: app/[sessionId]/page.tsx:534 vs lib/expenseSplits.ts:65

Failure scenario: expense amount ₱100.00, three custom amounts typed as `33.334`, `33.33`, `33.328` (the inputs are free-text `inputMode="decimal"`, not cent-constrained). Sum is 99.992, diff 0.008 — inside the client's 0.01 tolerance (passes, form submits) but outside the server's 0.005 tolerance (rejected). The user sees the generic server error "splits must sum to the expense amount" instead of the client's actionable "₱0.01 still needs to be split" — the exact user-facing gap the inline check exists to prevent. Narrow window (only sub-centavo entry hits the 0.005–0.01 band) but real.

Fix: have the client import `RECONCILED_EPSILON` from `lib/settle.ts` directly rather than hard-coding `0.01`. `lib/settle.ts` is plain TypeScript with no `server-only` guard and is already imported from `lib/expenseSplits.ts`, so nothing prevents a client component from importing the constant.

Stated tradeoff: tightening the client threshold to 0.005 makes the inline "₱X still needs to be split" message effectively unactionable at sub-centavo precision, since the displayed shortfall rounds to ₱0.01 either way. The complete fix is constraining the custom-amount inputs to cent precision — out of scope for this ticket, worth its own follow-up.

Found by: correctness-reviewer, holistic review (2026-08-28).
