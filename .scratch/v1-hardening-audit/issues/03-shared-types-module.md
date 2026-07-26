Status: backlog (not blocking V1 close)
Severity: Medium
Category: Best-practice

# Duplicated TypeScript interfaces, no shared types module

Participant, ExpenseSplit, Expense, Session, Settlement, SettlementsResponse are redeclared independently in [sessionId]/page.tsx, settle/page.tsx, and view/page.tsx (e.g. Settlement in settle:10-18 and view:40-48 are byte-identical). Can and do drift.

Fix sketch: one `lib/types.ts`, ideally aligned with the API's `serialize*` shapes in `lib/serialize.ts`.
