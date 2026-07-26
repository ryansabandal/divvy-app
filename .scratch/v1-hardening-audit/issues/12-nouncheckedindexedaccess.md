Status: backlog (not blocking V1 close)
Severity: Low
Category: Best-practice

# tsconfig strictness gap: noUncheckedIndexedAccess off

`tsconfig.json` has `strict: true` but not `noUncheckedIndexedAccess`. Code relies on unchecked index access in a few places (e.g. array-index reads in the settlement/split-building helpers under `lib/`). Now a single tsconfig instead of the old two (`backend/`'s + `frontend/`'s), so the fix is simpler than when this ticket was filed.

Fix sketch: enable the flag and fix the resulting type errors. Optional hardening, industry-trending default.
