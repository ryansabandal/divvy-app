Status: resolved
Severity: Low
Category: Security

# Error disclosure depends on NODE_ENV being set

Raw err.message is returned to clients unless NODE_ENV === "production". Not pinned anywhere in the repo (e.g. railway.toml), so if unset, internal error details leak.

Location: backend/src/index.ts:32-35

Fix sketch: explicitly set NODE_ENV=production in the Railway deploy env, or gate disclosure on a dedicated flag instead of relying on an unset default.

## Comments

Resolved for free during the serverless migration's Phase 3 route port (2026-07-26, commit c3a8efd): Next.js Route Handlers have no equivalent to Express's `NODE_ENV`-conditional error handler — there's no central catch-all that echoes `err.message` back to the client at all. Confirmed empirically via `next build && next start` in both dev and prod modes: neither leaks internal error detail. No code change was needed; this ticket is moot once `backend/`'s Express app is decommissioned in Phase 4.
