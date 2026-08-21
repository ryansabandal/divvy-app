Status: needs-triage
Severity: Medium
Category: Security

# Unbounded signed-URL minting lets any link-holder exhaust the Storage free-tier quota

`POST .../qr` has no per-session, per-participant, or per-time-window cap on how many signed upload URLs it mints, and each mint targets a fresh `randomUUID().jpg` path with `upsert: false`. The actual byte upload goes directly to Supabase and never traverses Vercel, so the existing `/api/*` WAF rule (50 req/IP/60s) only meters the cheap mint call, not the expensive write that follows it. At the WAF ceiling that's roughly 50 x 5MB = ~250MB/minute from one IP; the free tier's 1GB cap could fall in minutes, breaking uploads across every session, with cost/enforcement exposure beyond that.

This is a different risk than the CLAUDE.md-accepted "orphaned objects" case (an honest user's incomplete upload) — a mint is effectively a transferable, WAF-exempt write grant against shared storage, which no other route in this app has.

Location: app/api/sessions/[sessionId]/participants/[participantId]/qr/route.ts:19-34 (POST); lib/storage.ts:34-39

Needs triage: this needs a design decision, not just a code fix — options include capping unclaimed mints per participant, tracking minted-but-unpersisted paths for cleanup, or accepting the risk given the free-tier blast radius and app's current scale.

Found by: security-reviewer, Phase G.2 review (2026-08-16).
