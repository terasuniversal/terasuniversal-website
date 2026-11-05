-- Public registration review queue: Admin / Super Admin read access (SELECT only).
--
-- Why: public_registrations, public_registration_attendees and
-- public_registration_payments each carry a single "no direct client access"
-- policy (FOR ALL ... USING (false)) for anon and authenticated, so no staff
-- role can read them through an RLS-bound session. The read-only registration
-- review queue needs that read, without a service-role client.
--
-- What this adds (and nothing else):
--   * one permissive SELECT policy per table, TO authenticated, USING
--     app.is_admin(). app.is_admin() is app.has_min_role('admin'): the caller
--     must be active and rank admin or super_admin. Policies are OR-ed, so the
--     existing deny policy stays in place: anon, trainer, editor, client and
--     participant roles still see zero rows, and INSERT / UPDATE / DELETE stay
--     denied for everyone (no permissive write policy exists; the existing
--     SECURITY DEFINER RPCs are unaffected because they bypass RLS).
--   * GRANT SELECT (only) to authenticated. RLS cannot allow a read the role
--     has no privilege for. The numbered core migration revokes ALL from anon
--     and authenticated, but the live Staging catalogue showed full table
--     privileges for both roles on these tables (drift between the migration
--     file and the live database), so this grant is a no-op there and is what
--     makes the policy work wherever the revoke is still in force. It never
--     grants anon anything and adds no INSERT/UPDATE/DELETE/TRUNCATE.
--
-- Idempotent and guarded: a table that is absent is skipped; policies are
-- dropped (by this migration's own names only) and recreated; GRANT is a no-op
-- when already held.
--
-- NOT part of this change (recorded as separate follow-ups): tightening the
-- excess INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER privileges that the
-- Staging catalogue showed for anon and authenticated on these tables.

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

    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists %I on public.%I', t || '_admin_select', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (app.is_admin())',
      t || '_admin_select',
      t
    );

    execute format('grant select on table public.%I to authenticated', t);
  end loop;
end
$$;
