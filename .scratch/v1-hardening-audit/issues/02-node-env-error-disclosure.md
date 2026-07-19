Status: backlog (not blocking V1 close)
Severity: Low
Category: Security

# Error disclosure depends on NODE_ENV being set

Raw err.message is returned to clients unless NODE_ENV === "production". Not pinned anywhere in the repo (e.g. railway.toml), so if unset, internal error details leak.

Location: backend/src/index.ts:32-35

Fix sketch: explicitly set NODE_ENV=production in the Railway deploy env, or gate disclosure on a dedicated flag instead of relying on an unset default.
