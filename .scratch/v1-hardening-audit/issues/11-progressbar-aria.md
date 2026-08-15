Status: resolved
Severity: Low
Category: Best-practice / accessibility

# Progress bar has no ARIA semantics

settle/page.tsx:203-209 and view/page.tsx:162-168 render settlement progress as a plain div conveying a value, with no role="progressbar"/aria-valuenow/aria-valuemax. Screen readers get nothing.

Fix sketch: add ARIA roles/values, or rely on the adjacent "X of Y paid" text as an accessible equivalent (currently only a partial substitute).

## Comments

Fixed 2026-08-15, folded into the ticket-04 extraction (`components/SettlementProgress.tsx`) since both tickets touch the same markup — one place to fix ARIA instead of two. Added `role="progressbar"`, `aria-valuenow` (the paid count, not the percentage, to stay consistent with `aria-valuemax`), `aria-valuemin`, `aria-valuemax`, and `aria-valuetext` carrying the same peso context as the adjacent visible text, plus an `aria-label`. Verified against the live DOM via Playwright on both settle and view.
