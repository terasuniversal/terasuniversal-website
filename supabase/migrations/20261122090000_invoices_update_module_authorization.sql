-- M-S6 (CRM release candidate): direct UPDATE of public.invoices requires Invoices edit access.
--
-- Finding (Staging read-only review, 2026-11-21): policy invoices_update allowed any active Admin to update
-- invoice rows through the Data API with no module check, so an Admin with no Invoices module (or View only)
-- could change invoice fields directly, bypassing the UI and the M-S4b-guarded invoice RPCs.
--
-- Contract: the only application writer of public.invoices rows is updateInvoiceDraft
-- (app/admin/(protected)/invoices/actions.ts), guarded by requireRole("admin") AND
-- requireModuleAccess("invoices", "edit"). This migration makes RLS enforce exactly that, and nothing else:
--   * the previous expression app.is_admin() is kept and only AND-ed with the Invoices edit check (no widening);
--   * invoices_select is NOT changed here (its read set spans quotations/HRDF/finance; tracked separately);
--   * SECURITY DEFINER invoice RPCs (issue/cancel/payments) are unaffected (they bypass RLS and are guarded by M-S4b).
-- Fail-closed: if invoices_update is not exactly the reviewed definition, nothing is changed.
-- Forward-only, idempotent. Rollback: recreate invoices_update with using/with check (app.is_admin()) for public.

do $ms6$
declare
  v_qual text;
  v_check text;
  v_roles text;
begin
  select qual, with_check, roles::text into v_qual, v_check, v_roles
  from pg_policies where schemaname = 'public' and tablename = 'invoices' and policyname = 'invoices_update';

  if v_qual is null then
    raise exception 'ms6: policy public.invoices.invoices_update not found - nothing changed';
  end if;

  -- Already applied: leave as is.
  if v_qual like '%has_module_access_level(''invoices''::text, ''edit''::text)%' then
    raise notice 'ms6: invoices_update already requires Invoices edit - no change';
    return;
  end if;

  if v_qual <> 'app.is_admin()' or v_check is distinct from 'app.is_admin()' or v_roles <> '{public}' then
    raise exception 'ms6: invoices_update is not the reviewed definition (qual=%, check=%, roles=%) - nothing changed',
      v_qual, v_check, v_roles;
  end if;

  drop policy invoices_update on public.invoices;
  create policy invoices_update on public.invoices
    for update to authenticated
    using (app.is_admin() and (select public.has_module_access_level('invoices', 'edit')))
    with check (app.is_admin() and (select public.has_module_access_level('invoices', 'edit')));
end;
$ms6$;
