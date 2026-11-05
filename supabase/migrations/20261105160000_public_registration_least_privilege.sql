-- Public registration tables: least-privilege table grants (PROPOSAL; NOT APPLIED).
--
-- Scope: public.public_registrations, public.public_registration_attendees and
-- public.public_registration_payments ONLY. No schema, data, policy or function
-- change. Follows 20261105150000_public_registration_admin_read_policies.sql.
--
-- Target effective table privileges after this migration:
--   anon           none
--   authenticated  SELECT only. Rows are still limited to Admin and Super Admin
--                  by the SELECT policies from migration #1; the existing
--                  "no direct client access" deny policy (ALL, USING false) is
--                  not touched, so every write stays denied.
--   service_role   UNCHANGED (BYPASSRLS; the payment-start and Toyyibpay callback
--                  routes read these tables with it).
--   postgres, supabase_admin  UNCHANGED (table owner / platform superuser).
-- SQL function EXECUTE permissions are NOT touched. The registration RPCs are
-- SECURITY DEFINER functions owned by postgres, so they act with the owner's
-- privileges and do not depend on anything granted to anon or authenticated.
--
-- Why: TRUNCATE (like REFERENCES, TRIGGER and MAINTAIN) is not subject to RLS.
-- Read-only inspection of the live catalogues (2026-11-05) found:
--   Staging    anon and authenticated hold ALL (arwdDxtm) on all three tables,
--              inherited from the platform default privileges for tables that
--              postgres creates in schema public.
--   Production anon and authenticated hold NOTHING on these tables (only
--              postgres and service_role, plus supabase_admin as superuser).
-- On Production the revoke below is therefore a no-op and only the SELECT grant
-- takes effect (migration #1 already grants the same SELECT). The migration is
-- written to be correct and repeatable in both environments.
--
-- Baseline recorded for any rollback (a rollback must be separately authorised
-- and should restore only what a verified failure shows is needed; nothing in
-- the application or the registration functions inspected so far needs it):
--   Staging    anon, authenticated: SELECT, INSERT, UPDATE, DELETE, TRUNCATE,
--              REFERENCES, TRIGGER, MAINTAIN on each of the three tables.
--   Production anon, authenticated: no privileges.
--
-- One DO block = one statement = atomic: there is no window in which
-- authenticated holds no SELECT. REVOKE ALL on a role with no privileges is a
-- no-op, and GRANT SELECT is a no-op when already held, so re-running changes
-- nothing. A missing table is skipped.

do $$
declare
  t text;
begin
  foreach t in array array[
    'public_registrations',
    'public_registration_attendees',
    'public_registration_payments'
  ]
  loop
    if to_regclass(format('public.%I', t)) is null then
      raise notice 'skipping %: table does not exist', t;
      continue;
    end if;

    -- anon needs nothing: the public registration flow uses SECURITY DEFINER RPCs
    -- and server-side service_role calls, never direct table access.
    execute format('revoke all on table public.%I from anon', t);

    -- authenticated: drop everything, then keep read only (needed for the Admin
    -- policy to take effect). Includes TRUNCATE, REFERENCES, TRIGGER and MAINTAIN.
    execute format('revoke all on table public.%I from authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
  end loop;
end
$$;
