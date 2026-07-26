Status: backlog (not blocking V1 close)
Severity: Medium
Category: Security

# No rate limiting on any endpoint

Public no-auth API (by design) has no request-volume bound. Anonymous unbounded row creation can fill the Railway free-tier Postgres or degrade the service.

Location: `app/api/**` (whole app — no rate-limiting middleware or equivalent)

Fix sketch: `express-rate-limit` no longer applies (no Express) — needs a serverless-compatible approach, e.g. Vercel Edge Config/KV or `@upstash/ratelimit`, with a modest global cap (e.g. 100 req/min/IP), tighter on POST creation routes. Independently resurfaced as a Low finding in the 2026-07-26 post-migration security review.
