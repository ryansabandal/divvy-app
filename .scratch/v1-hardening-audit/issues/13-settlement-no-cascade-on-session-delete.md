Status: backlog (not blocking V1 close)
Severity: Low
Category: Correctness

# Settlement has no cascade on session delete, unlike ExpenseSplit

`ExpenseSplit.expense` has `onDelete: Cascade` (schema.prisma:66), so deleting an Expense cleans up its splits automatically. `Settlement.session`, `Settlement.debtor`, and `Settlement.creditor` have no `onDelete` at all (schema.prisma:80-82) — deleting a Session would leave orphaned Settlement rows referencing a session_id that no longer exists, or fail outright on the foreign key depending on Postgres's default `NO ACTION` behavior.

Not exercised today: no route deletes a Session (see API routes — only expenses are deletable). Surfaced while drawing the ER diagram in the README, not from a reported bug.

Location: backend/prisma/schema.prisma:72-83 (Settlement model, all three relations)

Fix sketch: add `onDelete: Cascade` to Settlement's `session` relation (and consider `Participant`'s `expenses`/`splits`/`owes`/`owed` relations too, same gap) — but only once a session-delete route actually exists. No fix needed while the gap is unreachable.
