-- Harness-only Supabase Auth compatibility grants for disposable local PostgreSQL.
-- Never apply this fixture to a Supabase environment or production migration.
DO $harness$
BEGIN
  IF to_regnamespace('auth') IS NULL
    OR to_regprocedure('auth.uid()') IS NULL
    OR to_regprocedure('auth.jwt()') IS NULL THEN
    RAISE EXCEPTION 'I3C requires the existing Supabase-compatible auth schema, auth.uid(), and auth.jwt(); refusing to synthesize replacements';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
    OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
    OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    RAISE EXCEPTION 'I3C requires Supabase API roles anon, authenticated, and service_role';
  END IF;
END;
$harness$;

-- Match the narrowly-scoped Supabase Auth helper access required by PostgREST.
-- No grants are made on app, public, or any product table/function.
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.jwt() TO anon, authenticated, service_role;
