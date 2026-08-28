Status: needs-triage
Severity: Medium
Category: Best-Practice

# Orphaned QR Storage objects survive the monthly retention cleanup

The pg_cron job (`delete from "Session" where created_at < now() - interval '1 month'`) deletes expired Sessions, cascading to `Participant` (and taking `qr_object_path` with it — see CLAUDE.md "Data retention"). But nothing deletes the corresponding **Storage** object. `deleteStorageObjectBestEffort` is wired only into the QR `PUT`/`DELETE` routes (a participant replacing or removing their own QR) — the retention job never calls it.

Location: no code location — this is a gap between prisma/migrations/20260828021955_participant_expense_cascade_on_session_delete (DB side) and the pg_cron SQL documented in CLAUDE.md's "Data retention" section (no Storage-side equivalent exists anywhere)

Consequence: every QR image ever uploaded to an eventually-expired session accumulates permanently in Storage, counting against the same 1 GB free-tier cap the retention job exists to protect in the first place. This is a slow, compounding leak that directly undermines the stated purpose of the cleanup job.

CLAUDE.md's "Data retention" section is otherwise thorough about documenting Supabase-side config applied by hand (the pg_cron job itself is exactly that) — the absence of any mention of a Storage lifecycle rule suggests none exists, though this can't be confirmed from the repo alone.

Needs triage — this is a design decision, not a code fix, mirroring how the pg_cron job itself needed a deliberate go/no-go rather than a drop-in patch. Options to weigh:
- A Supabase Storage lifecycle/expiration rule on the `qr/` prefix, if the platform supports one at this pricing tier.
- Extend the pg_cron job (or a paired scheduled job) to first collect `qr_object_path` values for expiring sessions, then issue Storage deletes, before or as part of the SQL delete.
- A periodic reconciliation job/route that lists Storage objects under `qr/` and removes any whose path isn't referenced by a live `Participant` row.
- Accept the leak as a documented residual (parallel to the existing "orphaned object" acceptance in CLAUDE.md's V2 constraints) if volume is judged negligible relative to the 1 GB cap.

**Decision from this session: file only, do not fix.** Needs the same hand-applied Supabase-side design work the pg_cron job itself required, which is out of scope for a code-focused fix session.

Found by: best-practice-reviewer, holistic review (2026-08-28).
