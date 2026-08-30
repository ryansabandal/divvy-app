Status: resolved
Severity: Medium
Category: Correctness

# Retention test "still refuses to delete a participant" is blocked by the wrong FK

`tests/retention.integration.test.ts`'s fourth test claims to guard the deliberate decision that
`Settlement.debtor`/`creditor` stay restrictive (RESTRICT, not CASCADE) so that deleting a
Participant directly still fails loudly. It does not actually exercise that constraint.

Location: tests/retention.integration.test.ts ("still refuses to delete a participant who is
referenced elsewhere")

The test deletes `p1` from the `createFullSession` fixture. `p1` is the expense's `paid_by`, so the
delete is blocked by `Expense_paid_by_fkey` — a constraint this test was never meant to be about.
Verified directly: deleting `p1` raises `23503` on `Expense_paid_by_fkey`; deleting `p2` (the
settlement's `from_id`, and not the expense payer) raises `23503` on `Settlement_from_id_fkey` — the
constraint the test's own comment describes. The test as written would pass identically even if the
`Settlement.debtor`/`creditor` relations were changed to cascade, because it never reaches them.

This is ticket 26's own lesson — "the cascade was reasoned about in schema comments and passed
review; nobody ever ran the statement" — recurring inside the regression test written specifically to
prevent that class of gap.

Fix: change the test to delete `p2` instead of `p1`, and assert the error is specifically the
Settlement FK (not just "rejects.toThrow()") so a future refactor that swaps which FK fires first is
caught rather than silently passing for the wrong reason.

Found by: correctness-reviewer, 3-lens Tier 1 review (2026-08-29); verified by the orchestrating
session with a direct raw-SQL probe distinguishing the two constraint names.

**2026-08-30 — fixed.** The test deletes `p2` (settlement debtor, not the expense payer) and asserts `rejects.toThrow(/Settlement_from_id_fkey/)`. Title narrowed from "referenced elsewhere" to "referenced by a settlement" — the vagueness was part of why the wrong FK went unnoticed.

**The ticket's suggested switch to raw SQL turned out to be unnecessary.** The constraint names had only ever been confirmed by a raw-SQL probe, so whether Prisma surfaces them was an open question. A direct probe against Prisma 7.8 settled it:

- `prisma.participant.delete()` on `p1` → `P2003`, constraint `Expense_paid_by_fkey`.
- `prisma.participant.delete()` on `p2` → `P2003`, constraint `Settlement_from_id_fkey`.

The name appears both in `err.meta.driverAdapterError.cause.constraint.index` and in the rendered message. The assertion matches the message rather than that nested meta path, which is driver-adapter-specific and brittle. So the test keeps `prisma.participant.delete()` and the file's existing `rejects.toThrow()` idiom, just with specificity added.

**Mutation-verified, per this ticket's own lesson.** Reverting `p2`→`p1` makes the test fail, and the failure names `Expense_paid_by_fkey` — proving it now discriminates the two constraints instead of passing for the wrong reason.
