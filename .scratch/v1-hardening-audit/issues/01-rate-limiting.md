Status: backlog (not blocking V1 close)
Severity: Medium
Category: Security

# No rate limiting on any endpoint

Public no-auth API (by design) has no request-volume bound. Anonymous unbounded row creation can fill the Railway free-tier Postgres or degrade the service.

Location: backend/src/index.ts (whole app — no express-rate-limit or equivalent)

Fix sketch: add `express-rate-limit` with a modest global cap (e.g. 100 req/min/IP), tighter on POST creation routes.
