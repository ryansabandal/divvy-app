Status: fix-on-touch (was: ready-for-agent)
Severity: Low
Category: Performance

# `loadSessionParticipants` pulls every participant column just to build a Set of ids

`loadSessionParticipants()` (used by both expense POST and PATCH) does `include: { participants: true }` and then only reads `p.id` to build a membership `Set`. Every call pulls each participant's name, payment method, payment details, and QR object path for no reason.

Location: lib/expenseSession.ts:11-14

Fix: narrow to `select: { participants: { select: { id: true } } }`. Drop-in change, zero behavioral risk.

**Collision note:** ticket 03 (expense-reorder-cap-asymmetry) needs this same `findUnique` to also fetch `_count: { select: { expenses: true } }` for its cap check. Whichever of these two tickets is implemented second must not drop what the other added — the final query needs both the participant id `select` and the expense `_count`.

Found by: best-practice-reviewer, holistic review (2026-08-28).

**Update (2026-08-30, ticket 32):** the helper is now `loadExpenseSessionContext` and its result type
`LoadExpenseSessionResult`, both in `lib/expenseSession.ts` — the old "participants" name is gone, so
this ticket's title and the `select` above refer to a symbol that no longer exists. Re-read the file
before working it.

The collision note above is now load-bearing rather than advisory: ticket 03's cap is what tickets 28
and 34 built on, so a narrowing that drops `_count: { select: { expenses: true } }` re-opens the
expense-cap dead end. It would be caught by `tsc` (the return statement destructures
`session._count.expenses`), not silently — but the fix is to keep `_count`, never to delete the
destructure to make the compiler quiet.
