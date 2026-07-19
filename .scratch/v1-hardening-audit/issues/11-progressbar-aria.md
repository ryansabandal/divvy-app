Status: backlog (not blocking V1 close)
Severity: Low
Category: Best-practice / accessibility

# Progress bar has no ARIA semantics

settle/page.tsx:203-209 and view/page.tsx:162-168 render settlement progress as a plain div conveying a value, with no role="progressbar"/aria-valuenow/aria-valuemax. Screen readers get nothing.

Fix sketch: add ARIA roles/values, or rely on the adjacent "X of Y paid" text as an accessible equivalent (currently only a partial substitute).
