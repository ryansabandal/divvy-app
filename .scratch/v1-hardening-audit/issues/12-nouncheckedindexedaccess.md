Status: backlog (not blocking V1 close)
Severity: Low
Category: Best-practice

# tsconfig strictness gap: noUncheckedIndexedAccess off

backend/tsconfig.json has strict: true but not noUncheckedIndexedAccess. Code relies on unchecked index access like splitRows[0].amount_owed (sessions.ts:217,260) and sortedLive[i] (sessions.ts:44-46). Frontend tsconfig likewise lacks it.

Fix sketch: enable the flag in both tsconfigs and fix the resulting type errors. Optional hardening, industry-trending default.
