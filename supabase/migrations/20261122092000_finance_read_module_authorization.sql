-- M-S5b (CRM release candidate): reading invoices, receipts and invoice payments requires a finance-related module.
--
-- Finding (Staging read-only review, 2026-11-21): invoices_select, receipts_select and invoice_payments_select were
-- app.has_min_role('editor') with no module check, so any editor (for example Quotations View only) could read every
-- invoice, receipt and payment (customer billing details and amounts) through the Data API with their own session.
--
-- Contract (Owner decision 2026-11-21, Option B: least privilege): full finance rows are readable only with the
-- Invoices module. Each policy keeps its previous expression and is AND-ed with Invoices view:
--   invoices, invoice_payments, receipts  <- invoices pages, invoice/receipt PDFs (invoices); executive KPIs are
--                                            super_admin (always passes).
-- Quotation pages no longer read these tables: they call public.get_quotation_invoice_summaries (20261122095000),
-- which returns only the summary columns for the requested quotations. The HRDF claims page uses the claim's own
-- invoice_number_snapshot and no longer reads invoices. Neither sales_quotations nor hrdf_claims grants full rows.
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
      ('invoices', 'invoices_select', array['invoices']),
      ('invoice_payments', 'invoice_payments_select', array['invoices']),
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
