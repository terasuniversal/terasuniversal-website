-- M-S5a (CRM release candidate): remove table privileges the CRM never needs from the client roles.
--
-- Finding (Staging read-only review, 2026-11-21): anon and authenticated held every table privilege on the CRM
-- tables, including TRUNCATE (which bypasses RLS), TRIGGER and REFERENCES, and the schema default ACL grants the same
-- to every new table. No current path executes them (no client-callable dynamic SQL, no pg_graphql, NOLOGIN roles),
-- but RLS would then be the only barrier, and every future table inherits the grants automatically.
--
-- Contract (verified against the application on 2026-11-21):
--   * anon uses none of these tables: every anon-applicable policy calls app.* functions, and anon has no USAGE on
--     schema app, so any anon request already fails; public forms write through SECURITY DEFINER RPCs.
--   * authenticated (staff) keeps SELECT/INSERT/UPDATE/DELETE, still governed by RLS; it never truncates, creates
--     triggers or adds foreign keys at runtime.
--   * service_role and postgres are not changed.
-- Default privileges: future tables created by postgres in schema public no longer grant TRUNCATE/TRIGGER/REFERENCES
-- (and MAINTAIN on PostgreSQL 17+) to anon/authenticated. Defaults owned by supabase_admin cannot be changed here.
-- Fail-closed (any listed table missing -> nothing changes), idempotent, forward-only.
-- Rollback: grant the revoked privileges back (see the list below) and restore the default privileges.

do $ms5a$
declare
  c_tables constant text[] := array[
    'sales_activity', 'sales_internal_lead_sources', 'sales_lead_attributions', 'sales_lead_contact_overrides',
    'sales_lead_metadata', 'sales_opportunities', 'sales_quotation_items', 'sales_quotations', 'sales_tasks',
    'invoices', 'invoice_payments', 'receipts', 'hrdf_claims', 'companies', 'staff_module_access', 'audit_logs',
    'marketing_contacts'];
  v_table text;
  v_missing text;
  v_has_maintain boolean := current_setting('server_version_num')::int >= 170000;
begin
  select string_agg(t, ', ') into v_missing
  from unnest(c_tables) t where to_regclass('public.' || t) is null;
  if v_missing is not null then
    raise exception 'ms5a: tables not found (%) - nothing changed', v_missing;
  end if;

  foreach v_table in array c_tables loop
    execute format('revoke all on table public.%I from anon', v_table);
    execute format('revoke truncate, trigger, references on table public.%I from authenticated', v_table);
    if v_has_maintain then
      execute format('revoke maintain on table public.%I from authenticated', v_table);
    end if;
  end loop;

  alter default privileges for role postgres in schema public revoke truncate, trigger, references on tables from anon, authenticated;
  if v_has_maintain then
    execute 'alter default privileges for role postgres in schema public revoke maintain on tables from anon, authenticated';
  end if;

  -- Postconditions.
  foreach v_table in array c_tables loop
    if has_table_privilege('anon', 'public.' || v_table, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
       or has_table_privilege('authenticated', 'public.' || v_table, 'TRUNCATE, REFERENCES, TRIGGER') then
      raise exception 'ms5a: privileges still present on public.% - rolled back', v_table;
    end if;
  end loop;
end;
$ms5a$;
