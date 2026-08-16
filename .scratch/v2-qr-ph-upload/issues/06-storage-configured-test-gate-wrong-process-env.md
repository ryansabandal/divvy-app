Status: ready-for-agent
Severity: Low
Category: Correctness

# STORAGE_CONFIGURED reads the test runner's env, not the server-under-test's

`STORAGE_CONFIGURED` is computed from `process.env` in the vitest process (via `dotenv/config`), but the QR routes actually execute in a different process — the local dev server, or a remote Vercel deployment when `TEST_BASE_URL` is set. The two env sets aren't guaranteed to match: running `TEST_BASE_URL=<preview-url> npm run test:integration` from a machine with local Storage keys would compute `STORAGE_CONFIGURED: true` and then fail every QR test against a preview deployment that never got the Storage env vars — a config gap reported as a code failure. The inverse (server configured, runner's env not) silently skips the whole QR suite while reporting green.

Location: tests/sessions.integration.test.ts:16-27

Fix sketch: derive the gate from the server under test instead — e.g. probe `POST .../qr` once at suite setup and skip based on whether it 500s on a Storage-config error, or add an explicit `TEST_STORAGE_CONFIGURED` opt-in env var documented alongside `TEST_BASE_URL`.

Found by: correctness-reviewer, Phase G.2 review (2026-08-16).
