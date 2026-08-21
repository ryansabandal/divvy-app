Status: ready-for-agent
Severity: Low
Category: Correctness

# No integration test covers the QR replace branch

Every PUT test in the new QR suite starts from `qr_object_path === null`. None does upload → persist → upload again → persist, so the `if (participant.qr_object_path) { deleteStorageObject(...) }` branch (the exact code involved in ticket 02) is never exercised by the suite.

Location: tests/sessions.integration.test.ts (the `describe.skipIf(!STORAGE_CONFIGURED)` PUT block)

Fix sketch: add a test that uploads+persists a QR, then uploads+persists a second one for the same participant, and asserts (a) `qr_code_url` now points at the new object and (b) the old object's public URL 404s.

Note: this ticket should be picked up alongside ticket 02, since fixing 02 will change what this test needs to assert.

Found by: correctness-reviewer, Phase G.2 review (2026-08-16).
