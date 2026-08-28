Status: ready-for-agent
Severity: Low
Category: Performance

# `loadSessionParticipants` pulls every participant column just to build a Set of ids

`loadSessionParticipants()` (used by both expense POST and PATCH) does `include: { participants: true }` and then only reads `p.id` to build a membership `Set`. Every call pulls each participant's name, payment method, payment details, and QR object path for no reason.

Location: lib/expenseSession.ts:11-14

Fix: narrow to `select: { participants: { select: { id: true } } }`. Drop-in change, zero behavioral risk.

**Collision note:** ticket 03 (expense-reorder-cap-asymmetry) needs this same `findUnique` to also fetch `_count: { select: { expenses: true } }` for its cap check. Whichever of these two tickets is implemented second must not drop what the other added — the final query needs both the participant id `select` and the expense `_count`.

Found by: best-practice-reviewer, holistic review (2026-08-28).
