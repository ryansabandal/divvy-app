Status: resolved
Severity: High
Category: Correctness

# The monthly retention job cannot delete any session that has expenses

`DELETE FROM "Session"` — the exact statement the `monthly-session-cleanup` pg_cron job runs — fails with `23503` for any session that has at least one expense with splits. Since a single `DELETE ... WHERE created_at < ...` is one statement, the whole thing rolls back: **no** sessions are deleted, not even the empty ones that would succeed on their own.

Location: prisma/schema.prisma:91 (`ExpenseSplit.participant`, no `onDelete`); the cron job in CLAUDE.md "Data retention"

```
update or delete on table "Participant" violates foreign key constraint
"ExpenseSplit_participant_id_fkey" on table "ExpenseSplit"
```

## Mechanism

Migration `20260828021955_participant_expense_cascade_on_session_delete` made `Session→Participant` and `Session→Expense` both `ON DELETE CASCADE`, and `Expense→ExpenseSplit` was already `Cascade`. The gap is `ExpenseSplit.participant_id → Participant`, which has **no delete action** (default `NO ACTION`).

`ExpenseSplit` is **two hops** from `Session` — reachable only via `Expense` — so Postgres runs the referential check for the `Participant` cascade before the second-level `Expense→ExpenseSplit` cascade has cleared the referencing rows.

`Settlement` does **not** hit this despite also referencing `Participant` (`from_id`/`to_id`, both with no delete action), because `Settlement.session_id` cascades directly from `Session` — one hop, so its rows are gone before the `Participant` check runs. That asymmetry is why the gap wasn't obvious by reading the schema.

## Reproduced (local, 2026-08-29)

| Case | Result |
|---|---|
| Session with participants only | deletes fine |
| Session with a frozen settlement plan, no expenses | deletes fine |
| **Session with an expense + splits** | **fails, `23503`** |

Verified through both `prisma.session.delete()` and a raw `delete from "Session" where ...`, so it is not a Prisma-layer artifact.

## Impact

Every real session has expenses, so in practice the retention job deletes nothing at all. It has been live in production since 2026-08-28 (commit `c221713`) and has not yet fired — first scheduled run is **2026-09-01 03:00 UTC**. Nothing surfaces the failure: pg_cron records it in `cron.job_run_details` and there is no alerting on that table. The free-tier storage/egress ceiling this job exists to protect therefore has no protection at all, silently.

## Fix

Add `onDelete: Cascade` to `ExpenseSplit.participant` in `prisma/schema.prisma`, generate a migration, and apply it to production **by hand on port 5432** (Vercel never runs `migrate deploy` — see CLAUDE.md "Database security posture").

Consider `Settlement.debtor`/`creditor` in the same migration: they currently survive on cascade ordering rather than on a declared rule, which is a fragile thing to depend on.

Verification must be the real statement, not the ORM path: create a session with an expense and splits, then run `delete from "Session" where id = '<id>'` and confirm it succeeds. Add an integration test asserting a session with expenses, splits, and a frozen plan is deletable in one statement — the gap survived review precisely because no test ever deleted a Session.

**Also fix the docs:** CLAUDE.md "Data retention" states the three cascades "make `DELETE FROM "Session"` a single-statement, fully cascading delete". That claim is false as written and is what let this ship — the reasoning was reviewed, the statement itself was never executed.

Found by: incidental — the delete failed while cleaning up probe data during the ticket 03 fix (2026-08-29). Not caught by the 2026-08-28 holistic review, which read the migration but never ran a Session delete.

## Comments

**2026-08-29 — fix applied locally, production migration still outstanding.** Kept at `ready-for-human`: the remaining action is a human one.

Resolution chosen (via AskUserQuestion): cascade `ExpenseSplit.participant` **only**. `Settlement.debtor`/`creditor` keep their restrictive FKs, so the "loud FK error beats silently voiding one side of a payment plan" reasoning recorded in `schema.prisma` survives intact — verified: deleting a Participant directly is still blocked (`Expense_paid_by_fkey`). The wider "cascade everything" option was rejected for eroding that decision; the "fix the cron SQL instead" option was rejected for moving retention correctness into Supabase-side config that no test or migration covers.

Landed:
- `prisma/schema.prisma` — `onDelete: Cascade` on `ExpenseSplit.participant`, with the two-hop mechanism written down.
- Migration `20260829005904_expensesplit_participant_cascade_on_delete` — exactly one DROP + one ADD CONSTRAINT, applied locally, `prisma migrate status` clean.
- `tests/retention.integration.test.ts` — 4 tests, new file (kept out of `sessions.integration.test.ts`, which is deliberately HTTP-only and never imports app internals). **Verified non-vacuous:** reverting the constraint on the local DB makes all 4 fail; restoring it makes them pass.
- `CLAUDE.md` "Data retention" — the false "together the three make a fully cascading delete" claim corrected, with the testing lesson recorded.

**Still to do, by hand:** apply the migration to production on the **direct 5432** session-pooler string (`DATABASE_URL='<direct-5432>' npx prisma migrate deploy`) — Vercel never runs `migrate deploy`. Do this **before 2026-09-01 03:00 UTC**, when the job next fires. Confirm afterwards by checking `cron.job_run_details` for that run.

Note: CLAUDE.md's inline schema block (Data Model section) still shows the pre-cascade FKs and is now contradicted by the corrected prose above it — that block is already tracked as ticket 20 and was left alone here.

**2026-08-29, later — production migration applied.** `npx prisma migrate deploy` on the direct 5432 string applied `20260829005904_expensesplit_participant_cascade_on_delete` and reported "All migrations have been successfully applied." It named **only** that migration, which also confirms `20260828021955` had genuinely reached production earlier — there was no second, hidden gap.

Invocation note worth keeping: the first attempt failed with `P1013` ("provided arguments are not supported... certain characters must be escaped"). The string was fine — it had deployed yesterday's migration successfully. The interactive shell was mangling it before Prisma parsed it. The form that works is `bash -c 'DATABASE_URL="<string>" npx prisma migrate deploy'`: a non-interactive shell has history expansion off, and the outer single quotes stop the calling shell from touching the password's special characters first. P1013 is a *parse* failure, so it never opens a socket — treat it as a string/shell problem, never a database or network one.

**Outstanding:** catalog verification that the constraint actually carries the cascade (`select confdeltype from pg_constraint where conname = 'ExpenseSplit_participant_id_fkey'` — expect `c`). Status stays `ready-for-human` until that returns `c`; a successful `migrate deploy` reports that the migration ran, not that the resulting state is correct.

**2026-08-29 — catalog verified, ticket closed.** `select conname, confdeltype from pg_constraint where conname = 'ExpenseSplit_participant_id_fkey'` returns `c` against production. That is the last link in the chain: the migration ran (`migrate deploy`), and the constraint that actually blocked the delete now carries `ON DELETE CASCADE` in the live catalog — not merely a migration that reported success.

The retention job's first run is **2026-09-01 03:00 UTC**. Nothing further is required for it to work, but `select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'monthly-session-cleanup') order by start_time desc limit 5;` after that date confirms it in practice, and is the only place a failure would ever surface.
