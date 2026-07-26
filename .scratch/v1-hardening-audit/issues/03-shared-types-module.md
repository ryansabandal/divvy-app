Status: resolved (2026-07-26) — new `lib/types.ts` holds `PaymentMethodType`/`SplitType`/`Participant`/`ExpenseSplit`/`Expense`/`Session`/`Settlement`/`SettlementsResponse`; all three pages import from it instead of redeclaring. `lib/serialize.ts`'s four `serialize*` functions now carry explicit return types from the same module (this was the actual fix sketch — binding the two together so drift is a compile error, not just a dedupe), which also narrowed `payment_method_type` enough to drop a cast in `app/[sessionId]/page.tsx`. 3-lens review caught and fixed: a naming collision with `lib/settle.ts`'s own `Settlement` type (renamed to `SettlementTransfer`), and two response shapes (`SettlementsResponse.stale`, `Session.expenses`) that don't apply to their POST counterparts — now documented in `lib/types.ts`.
Severity: Medium
Category: Best-practice

# Duplicated TypeScript interfaces, no shared types module

Participant, ExpenseSplit, Expense, Session, Settlement, SettlementsResponse are redeclared independently in [sessionId]/page.tsx, settle/page.tsx, and view/page.tsx (e.g. Settlement in settle:10-18 and view:40-48 are byte-identical). Can and do drift.

Fix sketch: one `lib/types.ts`, ideally aligned with the API's `serialize*` shapes in `lib/serialize.ts`.
