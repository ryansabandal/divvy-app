Status: resolved
Severity: Medium
Category: Best-Practice

# CLAUDE.md's inline Prisma schema block contradicts both schema.prisma and CLAUDE.md's own prose

`CLAUDE.md`'s "Data Model" section is a stale copy of the schema:

- `Participant` is shown **without `qr_object_path`** — but CLAUDE.md's own "QR Ph Code Upload — Shipped" section, later in the same file, names `Participant.qr_object_path` as the shipped storage slot. The inline block contradicts prose in the same document.
- `Participant.session` and `Expense.session` relations are shown **without `onDelete: Cascade`** — but CLAUDE.md's "Data retention" section states the cascade migration (`20260828021955_participant_expense_cascade_on_session_delete`) is done and load-bearing (the monthly pg_cron job depends on it to make `DELETE FROM "Session"` a single-statement cascading delete). `prisma/schema.prisma:47,73` confirms the cascade is actually present.

Also stale: the "Project Structure" file listing claims to document every `lib/` module but omits `lib/types.ts`, `lib/sessionPayer.ts`, `lib/sessionPayer.test.ts`, and `components/SessionPayerNote.tsx` — all four exist and three are load-bearing shared modules (sessionPayer.ts underpins the 2026-08-28 payer-picker feature).

Failure scenario: CLAUDE.md is the stated spec and the first document an agent or contributor reads. A reader trusting the schema block would believe Session delete is still RESTRICT-guarded (it isn't) and that QR paths live somewhere other than Participant. The 2026-08-28 docs-cleanup commit (4a8df36) verified QR *status* prose against source but never re-checked this schema copy — exactly the failure mode of duplicating a schema into prose that then goes stale independently.

Fix: sync the inline schema block to match prisma/schema.prisma exactly (or consider replacing it with a pointer to the file, since a duplicated schema is the actual root cause of this class of drift), and add the four missing files to the Project Structure listing.

Found by: best-practice-reviewer, holistic review (2026-08-28).

**Scope widened 2026-08-30 (absorbed ticket 33).** Two more files and one more relation drifted out of CLAUDE.md before this ticket was worked, and the 2026-08-30 slice added a third round of churn. **Treat the enumerated list above as a starting point, not the spec — re-diff CLAUDE.md against current source when picking this up.**

Known additions since this ticket was filed:
- Project Structure omits `lib/prismaErrors.ts` (ticket 04) and `tests/retention.integration.test.ts` (ticket 26).
- The Data Model block still shows `ExpenseSplit.participant` with no `onDelete: Cascade`, though commit `cabe488` added it and the prose "Data retention" section already describes it.
- `lib/expenseSession.ts` now also exports `MAX_EXPENSES_PER_SESSION` (tickets 28/34), and its helper was renamed to `loadExpenseSessionContext` (ticket 32). CLAUDE.md's one-line description of that module names neither.

The root cause named above still stands: a schema duplicated into prose drifts independently of the schema. Replacing the inline block with a pointer to `prisma/schema.prisma` would end this class of ticket rather than resetting its clock.

**2026-11-13 — resolved, using the root-cause fix this ticket suggested.** The Data Model section no longer copies the schema. It now points at `prisma/schema.prisma` and lists only the invariants the schema doesn't state on its own: cascade scope, `sort_order` vs `created_at`, the `payment_details` encoding, the single `qr_object_path` slot, and quantity-only fields. Changes and checks:
- **Project Structure:** re-diffed against `find app lib components tests schemas`, rather than this ticket's enumerated list. It now names every source file, including `app/[sessionId]/_components/`, `lib/prismaErrors.ts`, `tests/retention.integration.test.ts`, and `expenseSession.ts`'s `loadExpenseSessionContext()`/`MAX_EXPENSES_PER_SESSION`.
- **API Routes:** gained the three `/qr` endpoints.
- **Verification:** a reverse check (every file under those dirs appears in the tree) passes, and every function the tree names was grepped as an export.
- **Found during:** the 2026-11-13 prompt audit (`.scratch/plans/prompt-audit-2026-11-13.md`).
