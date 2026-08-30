Status: resolved
Severity: Low
Category: Best-Practice

# Tier 1 added two more files and one more relation to already-filed ticket 20's stale-docs scope

Location: CLAUDE.md ("Project Structure", "Data Model")

Already-filed ticket 20 (claude-md-stale-schema-block) enumerates a fixed list of omissions from
CLAUDE.md's Project Structure and Data Model sections. This Tier 1 slice added to that list before
ticket 20 was ever worked:

- `lib/prismaErrors.ts` (new, ticket 04) and `tests/retention.integration.test.ts` (new, ticket 26)
  are not listed in Project Structure's enumerated `lib/` and `tests/` files.
- The inline Data Model Prisma block still shows `ExpenseSplit.participant` with no
  `onDelete: Cascade`, even though commit `cabe488` (ticket 26) added that cascade and the prose
  "Data retention" section was updated to describe it.

This is not a new instance of drift so much as ticket 20's target moving while the ticket sat filed.
Whoever works ticket 20 needs to re-diff CLAUDE.md against the current repo state rather than working
from ticket 20's original enumerated list, or the fix will land already-stale.

Fix: when ticket 20 is picked up, treat its file list as a starting point and re-verify against
current `lib/`, `tests/`, and `prisma/schema.prisma` rather than trusting the list as written.

Found by: best-practice-reviewer, 3-lens Tier 1 review (2026-08-29).

**2026-08-30 — closed as scope-transferred, no code or doc change here.** This ticket's fix was "when ticket 20 is picked up, re-diff rather than trusting its list", which is an instruction to ticket 20 rather than work of its own — and ticket 20 sits outside the 27-35 slice.

Its substance is now appended to `20-claude-md-stale-schema-block.md`: the two missing files, the missing `ExpenseSplit.participant` cascade, and an explicit "re-diff, this list is a starting point" instruction. Also recorded there: the 2026-08-30 slice added a third round of drift (`lib/expenseSession.ts` gained `MAX_EXPENSES_PER_SESSION` and its helper was renamed), which is this ticket's own thesis repeating.

CLAUDE.md is deliberately untouched by this slice. Fixing it is ticket 20's job.
