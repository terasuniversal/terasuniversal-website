-- SST readiness + invoice snapshot behavior assertions.
-- Execute only against isolated Canonical Staging after the migration is applied.
-- This test owns all fixtures and ends with ROLLBACK; it must never run on Production.

begin;

create temporary table qa_sst_context (
  quote_off uuid not null,
  quote_on uuid not null,
  quote_invalid uuid not null,
  invoice_off uuid not null,
  invoice_on uuid not null
) on commit drop;

do $$
declare
  v_admin uuid;
  v_source_off uuid := gen_random_uuid();
  v_source_on uuid := gen_random_uuid();
  v_lead_off uuid := gen_random_uuid();
  v_lead_on uuid := gen_random_uuid();
  v_opp_off uuid := gen_random_uuid();
  v_opp_on uuid := gen_random_uuid();
  v_quote_off uuid := gen_random_uuid();
  v_quote_on uuid := gen_random_uuid();
  v_quote_invalid uuid := gen_random_uuid();
  v_invoice_off uuid;
  v_invoice_on uuid;
  v_error text;
begin
  select id into v_admin from public.profiles
  where is_active = true and role::text in ('super_admin', 'admin')
  order by created_at limit 1;
  if v_admin is null then raise exception 'assertion_failed: active admin required'; end if;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  insert into public.sales_internal_lead_sources (id, contact_name, email, company_name, course_interest, notes, created_by)
  values
    (v_source_off, 'QA SST Contact', 'qa-sst-off@example.test', 'QA-SST-TEST-OFF', 'Scaffolding', 'transactional fixture', v_admin),
    (v_source_on, 'QA SST Contact', 'qa-sst-on@example.test', 'QA-SST-TEST-ON', 'Scaffolding', 'transactional fixture', v_admin);

  insert into public.sales_lead_metadata (id, lead_source, source_id, status, priority, is_test, qualification_status, created_at, updated_at)
  values
    (v_lead_off, 'internal', v_source_off, 'new', 'medium', true, 'unqualified', now(), now()),
    (v_lead_on, 'internal', v_source_on, 'new', 'medium', true, 'unqualified', now(), now());

  insert into public.sales_opportunities
    (id, lead_metadata_id, opportunity_no, company_name, contact_person, contact_email, title, programme, stage, estimated_value, created_by, is_test)
  values (v_opp_off, v_lead_off, 'QA-SST-OPP-OFF', 'QA-SST-TEST', 'QA SST Contact', 'qa-sst-off@example.test', 'QA SST readiness off', 'Scaffolding', 'quotation', 200, v_admin, true);
  insert into public.sales_opportunities
    (id, lead_metadata_id, opportunity_no, company_name, contact_person, contact_email, title, programme, stage, estimated_value, created_by, is_test)
  values (v_opp_on, v_lead_on, 'QA-SST-OPP-ON', 'QA-SST-TEST', 'QA SST Contact', 'qa-sst-on@example.test', 'QA SST readiness on', 'Scaffolding', 'quotation', 200, v_admin, true);

  insert into public.sales_quotations
    (id, opportunity_id, quotation_no, revision_no, status, issue_date, valid_until, currency,
     subtotal, discount, sst_applicable, sst_rate, sst_amount, tax, total,
     tax_label_snapshot, tax_basis_snapshot, customer_company_name, customer_contact_name,
     customer_email, billing_address, training_service_address, created_by, is_test)
  values
    (v_quote_off, v_opp_off, 'QA-SST-OFF', 0, 'sent', current_date, current_date + 30, 'MYR',
     100, 0, false, 0, 0, 0, 100, null, null, 'QA-SST-TEST', 'QA SST Contact',
     'qa-sst@example.test', 'QA Billing', 'QA Training', v_admin, true),
    (v_quote_on, v_opp_on, 'QA-SST-ON', 0, 'sent', current_date, current_date + 30, 'MYR',
     100, 0, true, 6, 6, 6, 106, 'SST', 'approved synthetic basis', 'QA-SST-TEST', 'QA SST Contact',
     'qa-sst@example.test', 'QA Billing', 'QA Training', v_admin, true),
    (v_quote_invalid, v_opp_off, 'QA-SST-INVALID', 1, 'draft', current_date, current_date + 30, 'MYR',
     100, 0, false, 0, 0, 0, 100, null, null, 'QA-SST-TEST', 'QA SST Contact',
     'qa-sst@example.test', 'QA Billing', 'QA Training', v_admin, true);

  insert into public.sales_quotation_items (quotation_id, description, quantity, unit, unit_price, discount, sort_order, course_name_snapshot, hrdf_claim, package_includes_snapshot)
  values
    (v_quote_off, 'QA SST-off course', 1, 'pax', 100, 0, 1, 'QA SST-off Course', false, '[]'::jsonb),
    (v_quote_on, 'QA SST-on course', 1, 'pax', 100, 0, 1, 'QA SST-on Course', false, '[]'::jsonb);

  perform public.accept_quotation(v_quote_off);
  -- The second quotation is deliberately a separate revision-like fixture and
  -- is accepted through the same governed path in the test environment.
  perform public.accept_quotation(v_quote_on);
  v_invoice_off := public.create_invoice_from_quotation(v_quote_off);
  v_invoice_on := public.create_invoice_from_quotation(v_quote_on);
  insert into qa_sst_context values (v_quote_off, v_quote_on, v_quote_invalid, v_invoice_off, v_invoice_on);

  if (select sst_applicable from public.sales_quotations where id = v_quote_off) is distinct from false
     or (select sst_amount from public.sales_quotations where id = v_quote_off) <> 0
     or (select tax from public.sales_quotations where id = v_quote_off) <> 0
  then raise exception 'assertion_failed: SST-off quotation is not tax-neutral'; end if;

  if (select sst_applicable from public.invoices where id = v_invoice_off) is distinct from false
     or (select tax_amount from public.invoices where id = v_invoice_off) <> 0
     or (select grand_total from public.invoices where id = v_invoice_off) <> 100
  then raise exception 'assertion_failed: SST-off invoice inheritance mismatch'; end if;

  if (select sst_applicable from public.invoices where id = v_invoice_on) is distinct from true
     or (select tax_rate from public.invoices where id = v_invoice_on) <> 6
     or (select tax_amount from public.invoices where id = v_invoice_on) <> 6
     or (select tax_label_snapshot from public.invoices where id = v_invoice_on) <> 'SST'
     or (select grand_total from public.invoices where id = v_invoice_on) <> 106
  then raise exception 'assertion_failed: SST-on invoice inheritance mismatch'; end if;

  begin
    update public.sales_quotations set sst_rate = 8 where id = v_quote_on;
    raise exception 'assertion_failed: accepted quotation SST update unexpectedly succeeded';
  exception when others then
    v_error := sqlerrm;
    if v_error not like '%quotation_sst_snapshot_immutable%' and v_error not like '%accepted_quotation_immutable%' then
      raise exception 'assertion_failed: unexpected accepted quotation error: %', v_error;
    end if;
  end;

  if not exists (select 1 from public.invoices where id = v_invoice_on and tax_rate = 6 and tax_amount = 6) then
    raise exception 'assertion_failed: invoice SST arithmetic mismatch';
  end if;
end
$$;

do $$
declare
  v_quote uuid;
  v_error text;
begin
  select quote_invalid into v_quote from qa_sst_context;
  begin
    update public.sales_quotations set sst_rate = 101 where id = v_quote;
    raise exception 'assertion_failed: invalid SST rate unexpectedly succeeded';
  exception when others then
    v_error := sqlerrm;
    if v_error like 'assertion_failed:%' then raise; end if;
    if v_error not like '%sales_quotations_sst_rate_check%' then
      raise exception 'assertion_failed: invalid rate failed for wrong reason: %', v_error;
    end if;
  end;
  begin
    update public.sales_quotations set sst_amount = -1 where id = v_quote;
    raise exception 'assertion_failed: negative SST amount unexpectedly succeeded';
  exception when others then
    v_error := sqlerrm;
    if v_error like 'assertion_failed:%' then raise; end if;
    if v_error not like '%sales_quotations_sst_amount_check%' then
      raise exception 'assertion_failed: negative amount failed for wrong reason: %', v_error;
    end if;
  end;
  begin
    update public.sales_quotations set sst_applicable = false, sst_amount = 1 where id = v_quote;
    raise exception 'assertion_failed: SST-off non-zero amount unexpectedly succeeded';
  exception when others then
    v_error := sqlerrm;
    if v_error like 'assertion_failed:%' then raise; end if;
    if v_error not like '%sales_quotations_sst_off_amount_check%'
       and v_error not like '%sales_quotations_sst_amount_matches_tax_check%' then
      raise exception 'assertion_failed: SST-off amount failed for wrong reason: %', v_error;
    end if;
  end;
  begin
    update public.sales_quotations set tax = 1, sst_amount = null where id = v_quote;
    raise exception 'assertion_failed: arithmetic mismatch unexpectedly succeeded';
  exception when others then
    v_error := sqlerrm;
    if v_error like 'assertion_failed:%' then raise; end if;
    if v_error not like '%sales_quotations_total_arithmetic_check%' then
      raise exception 'assertion_failed: arithmetic mismatch failed for wrong reason: %', v_error;
    end if;
  end;
end
$$;

do $$
begin
  if not has_table_privilege('anon', 'public.invoices', 'select') then
    null;
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.invoices'::regclass
      and tgname = 'trg_enforce_invoice_financial_immutability'
  ) then raise exception 'assertion_failed: invoice immutability trigger missing'; end if;
end
$$;

-- The transaction is intentionally never committed.
rollback;
