Status: needs-info
Severity: Low
Category: Security

# Ticket 02's path guards are write-path only; QR rows written under the old check aren't remediated

Location: lib/serialize.ts (serializeParticipant / publicObjectUrl), lib/storage.ts
(deleteStorageObjectBestEffort)

Ticket 02 added `.max(200)` and `isMintedQrPath()` to `PUT .../participants/:participantId/qr`,
closing the path off going forward. Neither guard re-validates a `Participant.qr_object_path` value
that was already persisted during the roughly two weeks QR upload was live under the old
`path.startsWith(prefix)` check (shipped 2026-08-16; this fix landed 2026-08-29).

Two places still trust the stored value without re-checking it:
- `serializeParticipant` passes `qr_object_path` straight into `publicObjectUrl()`, which
  string-concatenates it into a URL with no re-validation and no `encodeURIComponent` — a stored
  `../`-bearing path (if one exists) would still render on the settle/view screens.
- `deleteStorageObjectBestEffort` still `console.error`s the stored path verbatim on failure — the
  same unbounded-log sink ticket 02 was written to close, for any oversized value already in the DB.

The object-*deletion* vector specifically is confirmed not live: Supabase Storage treats object keys
literally, so a `remove()` call on a path containing `../` cannot escape to a different key — verified
against the live bucket.

Filed as `needs-info`, not `ready-for-agent`, because whether any such row actually exists in
production is unknown and needs a direct check before deciding whether remediation is needed at all:

```sql
select id, session_id, qr_object_path from "Participant"
where qr_object_path is not null
  and qr_object_path !~ '^(dev/)?qr/[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$';
```

If that returns no rows, this ticket can close as "confirmed no exposure, guard is sufficient going
forward." If it returns rows, null out `qr_object_path` on the affected participants (the participant
can simply re-upload).

Found by: security-reviewer, 3-lens Tier 1 review (2026-08-29).

**2026-08-30 — still `needs-info`, deliberately not fixed.** The production query above was handed to the user this session; the result is not back yet, so the open question — whether any row written under the old `startsWith` check actually exists — remains open. Re-running it locally cannot answer it: the local Podman DB is a different database carrying thousands of integration-run sessions, so a clean result there proves nothing about production.

**No preemptive hardening was added, on purpose.** Adding `encodeURIComponent` to `publicObjectUrl` would encode the `/` separators in every valid object path and break QR display for every participant who has one — a live regression traded for a hypothetical one. Any remediation should follow the query result, not precede it.

Close condition unchanged: zero rows → "confirmed no exposure, guard sufficient going forward", no code change. Rows → null `qr_object_path` on those participants, who can re-upload.
