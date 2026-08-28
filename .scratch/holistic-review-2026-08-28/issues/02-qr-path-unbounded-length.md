Status: ready-for-agent
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
