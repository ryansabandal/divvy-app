Status: resolved (2026-07-26) — two Vercel WAF custom rules, no application code. Rate-limit rule: `/api/*`, all methods, 50 req/IP/60s, deny 1m. Bypass rule: requests carrying the existing `x-vercel-protection-bypass` automation secret skip the limit entirely, so the integration suite (182 mutating + GET requests/run) doesn't have to share headroom with the real-world cap. Verified live against production: 80/80 integration tests pass, and a manual curl loop confirms 429s past the threshold on both a mutating route and `GET /api/health`. See README.md's "Rate limiting (Vercel WAF)" section for the durable record.
Severity: Medium
Category: Security

# No rate limiting on any endpoint

Public no-auth API (by design) has no request-volume bound. Anonymous unbounded row creation can fill the Railway free-tier Postgres or degrade the service.

Location: `app/api/**` (whole app — no rate-limiting middleware or equivalent)

Fix sketch: `express-rate-limit` no longer applies (no Express) — needs a serverless-compatible approach, e.g. Vercel Edge Config/KV or `@upstash/ratelimit`, with a modest global cap (e.g. 100 req/min/IP), tighter on POST creation routes. Independently resurfaced as a Low finding in the 2026-07-26 post-migration security review.
