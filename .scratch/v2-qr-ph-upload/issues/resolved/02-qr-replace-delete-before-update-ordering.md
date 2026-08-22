Status: resolved
Severity: Medium
Category: Correctness

# QR replace: delete-before-update ordering causes a false 500 + orphan, and same-path retry deletes the live object

Two related bugs in the same code, same fix:

1. **Ordering contradicts its own comment.** `PUT .../qr` deletes the participant's old Storage object *before* writing the new path to the DB, with a comment claiming "a failure here isn't fatal to the request — the new path still wins." That isn't what the code does: `deleteStorageObject` throws uncaught on a Storage error, which propagates as an unhandled rejection → Next returns 500 → `prisma.participant.update` never runs. A participant tapping "Replace" during a transient Storage blip sees a failed request even though their new image uploaded successfully, and the new object is now an orphan (old path still on the row, referencing whatever survived the failed delete).
2. **Same-path replay deletes the object it's about to reference.** There's no `path !== participant.qr_object_path` guard, so a retried PUT (network timeout, client retry) with the same path deletes the just-uploaded object, then "persists" a path that no longer exists.

Location: app/api/sessions/[sessionId]/participants/[participantId]/qr/route.ts:63-69

Fix sketch: persist the new path first (`prisma.participant.update`), then attempt to delete the old object in a try/catch (log and ignore failure — it's already an accepted orphan risk per CLAUDE.md), and skip the delete entirely when `path === participant.qr_object_path`.

Found by: correctness-reviewer, Phase G.2 review (2026-08-16).

Resolved 2026-08-22: applied the fix sketch (persist-first, skip-on-same-path, best-effort delete), then re-reviewed by parallel correctness + security subagents on the diff. Security review: no findings. Correctness review: no blocking findings, but 2 Low/plausible follow-ups, both fixed in the same pass:
1. The original try/catch could still block the response indefinitely on a *hung* (not thrown) Storage delete. Fixed by extracting `deleteStorageObjectBestEffort(path, timeoutMs = 8000)` in `lib/storage.ts` — swallows all errors and gives up after a bounded timeout via `Promise.race`, so a hang adds at most that bound to the response instead of blocking it indefinitely.
2. `DELETE`'s handler (untouched by the original fix) still deleted-before-updated, now inconsistent with `PUT`'s corrected ordering. Reordered `DELETE` to match: clear the row first, then best-effort-delete via the same helper.
A third point — no test exercises the try/catch/timeout wrapper itself (removing it wouldn't fail any test) — was left as an accepted gap: forcing a real Storage error or hang without mocking isn't practical, and this suite's QR tests are deliberately real-Storage-only, no mocking.
Verified: 91/91 integration tests pass (including the new ticket-05 replace/replay tests) against real Supabase Storage.
