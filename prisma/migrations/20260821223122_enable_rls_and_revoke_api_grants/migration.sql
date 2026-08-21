-- Close the PostgREST/anon exposure surfaced by Supabase's Security Advisor (2026-08-21).
--
-- Background: Supabase pre-registers default privileges granting the `anon` and `authenticated`
-- roles access to any table created in `public` by the `postgres` role -- which is exactly how
-- Prisma migrations create them. PostgREST then serves those tables at /rest/v1/* to anyone
-- holding the published anon key. Confirmed exploitable before this migration: an anon-key GET
-- returned every row of every table, including real phone numbers and bank account numbers in
-- Participant.payment_details, with write access too.
--
-- Two independent layers below, deliberately. RLS alone yields "200 []" (safe but indistinguishable
-- from an empty database); the REVOKE turns it into a hard permission error.

-- Layer 1: deny-by-default at the row level. No policies are created on purpose -- nothing should
-- ever read these tables through PostgREST. The app is unaffected because Postgres exempts a
-- table's OWNER from RLS unless FORCE ROW LEVEL SECURITY is set, and Prisma connects as `postgres`,
-- which owns all six tables (verified through the pooled 6543 path on 2026-08-21).
ALTER TABLE "Session" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Participant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Expense" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExpenseSplit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Settlement" ENABLE ROW LEVEL SECURITY;
-- IF EXISTS: this table is created by Prisma's migrate engine, not by a migration file, so it is
-- not guaranteed to exist in every replay context (notably the shadow DB `migrate dev` builds).
-- Enabling RLS on it does not break migrate deploy/status -- Prisma reads it as the owner, and the
-- engine's lock is a pg_advisory_lock, which RLS does not govern.
ALTER TABLE IF EXISTS "_prisma_migrations" ENABLE ROW LEVEL SECURITY;

-- Layer 2: take away the grants themselves.
-- Wrapped in a DO block with to_regrole() guards so this same file also replays cleanly on local
-- Postgres and in the shadow database, where none of these roles exist (compose.yml runs a bare
-- postgres:16 as POSTGRES_USER=divvy). There is no `REVOKE ... IF EXISTS`; a bare REVOKE against a
-- missing role aborts the whole migration. to_regrole() returns NULL instead of raising, and the
-- dynamic EXECUTE keeps the role name unresolved until the guard has passed.
--
-- `service_role` is deliberately NOT revoked, deviating from Supabase's own snippet: it carries
-- BYPASSRLS, so none of this ever protected against a leaked service key, and revoking would close
-- no real hole while removing a legitimate admin/debug path. Do not "tidy" it in.
DO $$
DECLARE
  api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    -- Skip roles that do not exist here (local dev, shadow DB) rather than failing the migration
    CONTINUE WHEN to_regrole(api_role) IS NULL;

    -- Revoke access to the tables that already exist
    EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', api_role);
    EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', api_role);

    -- Its own guard: `postgres` does not exist locally either (compose.yml uses `divvy`), so an
    -- unguarded ALTER DEFAULT PRIVILEGES FOR ROLE postgres would abort the migration there.
    IF to_regrole('postgres') IS NOT NULL THEN
      -- The durable half. Postgres has no "default RLS": every future table needs its own ENABLE
      -- ROW LEVEL SECURITY, which relies on nobody forgetting. Revoking the default privileges is
      -- the only protection that applies automatically to tables created later. FOR ROLE postgres
      -- is required -- omitting it defaults to CURRENT_ROLE -- and it governs objects created by
      -- that role, which is precisely what Prisma does.
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM %I', api_role);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', api_role);
    END IF;
  END LOOP;
END
$$;

-- ON FUNCTIONS is omitted by decision, not oversight: this schema has no functions and Prisma
-- creates none. Add it here if that ever changes.
