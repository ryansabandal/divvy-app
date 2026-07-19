Status: backlog (not blocking V1 close)
Severity: Low
Category: Best-practice

# CORS origins and port hardcoded in index.ts

index.ts:9 hardcodes ["http://localhost:3000", "https://divvy-app-zeta.vercel.app"]; line 40 hardcodes fallback port 4000. A preview deploy or domain change requires a code edit.

Fix sketch: drive allowed origins from an env var (e.g. CORS_ORIGINS), consistent with config-via-env elsewhere.
