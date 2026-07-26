Status: resolved (2026-07-26) — added `onDelete: Cascade` to `Settlement.session` only; `Settlement.debtor`/`.creditor` and `Participant.expenses`/`.splits`/`.owes`/`.owed` deliberately left RESTRICT, since no route deletes a Participant and a loud FK error beats silent data loss on one side of a payment plan (documented in `prisma/schema.prisma`, corrected once by review for accuracy — see the ticket 03 note above for the cross-file cleanup). Migration `20260726103632_settlement_cascade_on_session_delete` applied to local Podman Postgres only; not yet applied to Supabase production (deliberate — a future standalone step, not this cleanup pass).
Severity: Low
Category: Correctness

# Settlement has no cascade on session delete, unlike ExpenseSplit

`ExpenseSplit.expense` has `onDelete: Cascade` (schema.prisma:66), so deleting an Expense cleans up its splits automatically. `Settlement.session`, `Settlement.debtor`, and `Settlement.creditor` have no `onDelete` at all (schema.prisma:80-82) — deleting a Session would leave orphaned Settlement rows referencing a session_id that no longer exists, or fail outright on the foreign key depending on Postgres's default `NO ACTION` behavior.

Not exercised today: no route deletes a Session (see API routes — only expenses are deletable). Surfaced while drawing the ER diagram in the README, not from a reported bug.

Location: prisma/schema.prisma (Settlement model, all three relations)

Fix sketch: add `onDelete: Cascade` to Settlement's `session` relation (and consider `Participant`'s `expenses`/`splits`/`owes`/`owed` relations too, same gap) — but only once a session-delete route actually exists. No fix needed while the gap is unreachable.
