Status: resolved
Severity: Low
Category: Best-Practice

# Duplicated "mint -> upload -> persist" sequence across QR integration tests

The three-step mint/upload/persist setup sequence is repeated verbatim across two tests in the new QR suite (the PUT persist test, and the DELETE clear-to-null test). The file already has an established convention for exactly this — `createSessionWithParticipants()` and `createEvenExpense()` are both extracted helpers used dozens of times for the same reason.

Location: tests/sessions.integration.test.ts (PUT and DELETE `describe.skipIf(!STORAGE_CONFIGURED)` blocks)

Fix sketch: extract a `uploadQrForParticipant(sessionId, participantId)` helper mirroring the existing `createEvenExpense` pattern. Pick this up alongside ticket 05, since the new replace-branch test will want the same helper.

Found by: best-practice-reviewer, Phase G.2 review (2026-08-16).

Resolved 2026-08-22, alongside tickets 02/05. Extracted `uploadQrForParticipant(sessionId, participantId)`, mirroring the existing `createEvenExpense` pattern; the PUT-persist test and the DELETE-clear test both use it now instead of repeating the mint/upload/persist sequence.
