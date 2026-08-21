Status: ready-for-agent
Severity: Medium
Category: Correctness

# QR replace: delete-before-update ordering causes a false 500 + orphan, and same-path retry deletes the live object

Two related bugs in the same code, same fix:

1. **Ordering contradicts its own comment.** `PUT .../qr` deletes the participant's old Storage object *before* writing the new path to the DB, with a comment claiming "a failure here isn't fatal to the request — the new path still wins." That isn't what the code does: `deleteStorageObject` throws uncaught on a Storage error, which propagates as an unhandled rejection → Next returns 500 → `prisma.participant.update` never runs. A participant tapping "Replace" during a transient Storage blip sees a failed request even though their new image uploaded successfully, and the new object is now an orphan (old path still on the row, referencing whatever survived the failed delete).
2. **Same-path replay deletes the object it's about to reference.** There's no `path !== participant.qr_object_path` guard, so a retried PUT (network timeout, client retry) with the same path deletes the just-uploaded object, then "persists" a path that no longer exists.

Location: app/api/sessions/[sessionId]/participants/[participantId]/qr/route.ts:63-69

Fix sketch: persist the new path first (`prisma.participant.update`), then attempt to delete the old object in a try/catch (log and ignore failure — it's already an accepted orphan risk per CLAUDE.md), and skip the delete entirely when `path === participant.qr_object_path`.

Found by: correctness-reviewer, Phase G.2 review (2026-08-16).
