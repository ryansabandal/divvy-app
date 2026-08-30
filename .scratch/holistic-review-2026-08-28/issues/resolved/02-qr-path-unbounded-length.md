Status: resolved
Severity: Medium
Category: Security

# `path` is the only API field reaching the database with no length cap

`setQrObjectPathSchema` validates `path` with only `z.string().min(1)`. The route's `startsWith(qrObjectPrefix(sessionId))` check constrains the prefix, not the length, so an arbitrarily long string still passes.

Location: schemas/sessions.ts:41-43; app/api/sessions/[sessionId]/participants/[participantId]/qr/route.ts:54

Failure scenario: no session link is needed. An attacker creates their own session (`POST /api/sessions`, unauthenticated by design), gets back a `participants[].id`, then sends `PUT .../qr` with `{"path": "qr/<their-sid>/" + "A".repeat(4_000_000)}`. Nothing truncates upstream — no `bodySizeLimit` in `next.config.ts`/`vercel.json`, no cap in the route — so the only ceiling is Vercel's platform 4.5 MB request cap. Against the existing WAF rule (50 req/IP/60s) that's ~200 MB/min of persistent writes into `Participant.qr_object_path` (Postgres `TEXT`), filling the 500 MB free-tier database in single-digit minutes and denying service to every session.

Secondary: the same unbounded string flows into `console.error("Best-effort Storage delete failed", path, err)` (lib/storage.ts:60) on replace/remove — multi-MB log flooding.

This is the same class resolved ticket 18 already closed for the participant name/payment_details fields (capped at 100/200); the QR schema, added later, reintroduced it.

Fix: validate the exact minted shape instead of just a prefix — the mint (`lib/storage.ts:35`) always produces `<prefix><uuid>.jpg`, so a regex `^<escaped prefix>[0-9a-f-]{36}\.jpg$` both bounds the length and rejects nothing legitimate. **This also closes tracked ticket 10** (the `..` path-traversal bypass) in the same edit, since a regex anchored to the exact minted shape can't be bypassed with `..` segments either.

Found by: security-reviewer, holistic review (2026-08-28).

## Comments

**2026-08-29 — fixed, in two halves.** The ticket pointed only at the schema, but `setQrObjectPathSchema` is a module-level constant with no access to `sessionId`, so it cannot validate the minted shape by itself:

- `schemas/sessions.ts` — `.max(200, "path is too long")` on `path`, matching the 100/200 convention resolved ticket 18 established for the participant fields. This is what actually closes the DoS.
- `lib/storage.ts` — new `isMintedQrPath(sessionId, path)`, placed **beside the mint** so the only producer of these paths and the only validator of them cannot drift apart. The route's `startsWith` prefix check now calls it.

**Two traps in the filed fix sketch, both avoided.** The sketch's `[0-9a-f-]{36}` also matches 36 hyphens — a legal Storage object name that is not a UUID. Replaced with a real v4 pattern. And `qrObjectPrefix()` interpolates `process.env.SUPABASE_STORAGE_PREFIX`, so the prefix is regex-escaped before embedding; an env value containing a metacharacter would otherwise silently change what the anchor matches.

Verified end-to-end against the running route (not by reading the regex), with the correct `dev/` prefix:

| Path | Result |
|---|---|
| `dev/qr/<sid>/<uuid>.jpg` | **200** — legitimate path still accepted |
| 4,000,056-byte body, oversized `path` | **400** `path is too long` (schema fires first) |
| `dev/qr/<sid>/../../qr/<victim>/<uuid>.jpg` | 400 |
| `dev/qr/<sid>/../<uuid>.jpg` | 400 |
| 36 hyphens | 400 |
| `dev/qr/<sid>/sub/<uuid>.jpg` | 400 |
| uppercase UUID | 400 |
| `dev/qr/<victim>/<uuid>.jpg` | 400 |
| missing env prefix | 400 |

The oversized case needed the body written to a file — passing 4 MB through shell argv fails with "Argument list too long", and an unnoticed failure there leaves a stale response buffer that reads like a pass. Worth knowing for whoever writes the integration test in step 9.

**Closes `v2-qr-ph-upload/10`** (the `..` traversal bypass) as predicted — flipped and moved to that feature's `resolved/`, with the traversal rows above as the evidence.
