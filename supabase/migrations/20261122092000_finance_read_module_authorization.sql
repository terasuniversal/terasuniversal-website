-- M-S5b (CRM release candidate): reading invoices, receipts and invoice payments requires a finance-related module.
--
-- Finding (Staging read-only review, 2026-11-21): invoices_select, receipts_select and invoice_payments_select were
-- app.has_min_role('editor') with no module check, so any editor (for example Quotations View only) could read every
-- invoice, receipt and payment (customer billing details and amounts) through the Data API with their own session.
--
-- Contract: each policy keeps its previous expression and is AND-ed with the modules of its application readers
-- (verified 2026-11-21; same read-set method as M-S4):
--   invoices          <- invoices pages/PDF (invoices), HRDF claims page (hrdf_claims), quotation list/detail
--                        (sales_quotations); executive KPIs are super_admin (always passes).
--   invoice_payments  <- invoice detail/PDF (invoices), quotation list/detail (sales_quotations).
--   receipts          <- invoice detail and receipt PDF (invoices).
-- The ToyyibPay callback uses the service-role client (bypasses RLS) and SECURITY DEFINER finance RPCs are unaffected.
-- Requires app.has_any_module_access (M-S4, 20261121120000). Fail-closed on any unexpected existing definition.
-- Idempotent, forward-only. Rollback: recreate each policy as select for public using (app.has_min_role('editor')).

do $ms5b$
declare
  r record;
  v_qual text;
  v_roles text;
begin
  if to_regprocedure('app.has_any_module_access(text[],text)') is null then
    raise exception 'ms5b: app.has_any_module_access (M-S4) is missing - nothing changed';
  end if;

  for r in
    select * from (values
      ('invoices', 'invoices_select', array['invoices', 'hrdf_claims', 'sales_quotations']),
      ('invoice_payments', 'invoice_payments_select', array['invoices', 'sales_quotations']),
      ('receipts', 'receipts_select', array['invoices'])
    ) t(tbl, pol, modules)
  loop
    select qual, roles::text into v_qual, v_roles
    from pg_policies where schemaname = 'public' and tablename = r.tbl and policyname = r.pol and cmd = 'SELECT';
    if v_qual is null then
      raise exception 'ms5b: policy %.% not found - nothing changed', r.tbl, r.pol;
    end if;
    if v_qual like '%has_any_module_access%' then
      continue; -- already applied
    end if;
    if v_qual <> 'app.has_min_role(''editor''::user_role)' or v_roles <> '{public}' then
      raise exception 'ms5b: %.% is not the reviewed definition (qual=%, roles=%) - nothing changed', r.tbl, r.pol, v_qual, v_roles;
    end if;

    execute format('drop policy %I on public.%I', r.pol, r.tbl);
    execute format(
      'create policy %I on public.%I for select to authenticated using ('
      || 'app.has_min_role(''editor''::public.user_role) and (select app.has_any_module_access(%L::text[], ''view'')))',
      r.pol, r.tbl, r.modules);
  end loop;
end;
$ms5b$;
