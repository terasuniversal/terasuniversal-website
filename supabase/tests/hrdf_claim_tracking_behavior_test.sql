-- HRDF Claim Tracking behavior assertions.
-- Run only against isolated Canonical Staging QA. All fixtures and audit
-- rows are contained in one transaction and the final ROLLBACK is required.
-- Two-session FOR UPDATE behavior is covered by the separate concurrency
-- harness; this file verifies deterministic single-session invariants.

begin;

create temporary table qa_context (
  admin_id uuid not null,
  non_hrdf_invoice_id uuid not null,
  hrdf_invoice_id uuid not null,
  claim_id uuid,
  payment_reference text not null
) on commit drop;

do $$
declare
  v_admin uuid;
  v_source uuid := gen_random_uuid();
  v_source_hrdf uuid := gen_random_uuid();
  v_lead_non_hrdf uuid := gen_random_uuid();
  v_lead_hrdf uuid := gen_random_uuid();
  v_opp_non_hrdf uuid := gen_random_uuid();
  v_opp_hrdf uuid := gen_random_uuid();
  v_quote_non_hrdf uuid := gen_random_uuid();
  v_quote_hrdf uuid := gen_random_uuid();
  v_item_non_hrdf uuid := gen_random_uuid();
  v_item_hrdf uuid := gen_random_uuid();
  v_non_hrdf_invoice uuid;
  v_hrdf_invoice uuid;
begin
  select id into v_admin
  from public.profiles
  where is_active = true and role::text in ('super_admin', 'admin')
  order by created_at limit 1;
  if v_admin is null then
    raise exception 'assertion_failed: active admin profile is required';
  end if;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  insert into public.sales_internal_lead_sources
    (id, contact_name, email, company_name, course_interest, notes, created_by)
  values
    (v_source, 'QA HRDF SQL Contact', 'qa-hrdf-sql@example.test',
     'QA-HRDF-SQL-TEST', 'Scaffolding', 'transactional fixture', v_admin);
  insert into public.sales_internal_lead_sources
    (id, contact_name, email, company_name, course_interest, notes, created_by)
  values
    (v_source_hrdf, 'QA HRDF SQL Contact 2', 'qa-hrdf-sql-2@example.test',
     'QA-HRDF-SQL-TEST', 'Scaffolding', 'transactional fixture', v_admin);

  insert into public.sales_lead_metadata
    (id, lead_source, source_id, status, priority, is_test,
     qualification_status, created_at, updated_at)
  values
    (v_lead_non_hrdf, 'internal', v_source, 'new', 'medium', true,
     'unqualified', now(), now()),
    (v_lead_hrdf, 'internal', v_source_hrdf, 'new', 'medium', true,
     'unqualified', now(), now());

  insert into public.sales_opportunities
    (id, lead_metadata_id, opportunity_no, company_name, contact_person,
     contact_email, title, programme, stage, estimated_value, created_by, is_test)
  values
    (v_opp_non_hrdf, v_lead_non_hrdf, 'QA-HRDF-SQL-OPP-N', 'QA-HRDF-SQL-TEST',
     'QA HRDF SQL Contact', 'qa-hrdf-sql@example.test', 'QA non-HRDF invoice',
     'Scaffolding', 'quotation', 100, v_admin, true),
    (v_opp_hrdf, v_lead_hrdf, 'QA-HRDF-SQL-OPP-H', 'QA-HRDF-SQL-TEST',
     'QA HRDF SQL Contact', 'qa-hrdf-sql@example.test', 'QA HRDF invoice',
     'Scaffolding', 'quotation', 100, v_admin, true);

  insert into public.sales_quotations
    (id, opportunity_id, quotation_no, revision_no, status, issue_date,
     valid_until, currency, subtotal, discount, sst_applicable, sst_rate,
     tax, total, created_by, is_test, customer_company_name,
     customer_contact_name, customer_email, billing_address, training_service_address)
  values
    (v_quote_non_hrdf, v_opp_non_hrdf, 'QA-HRDF-SQL-Q-N', 1, 'sent', current_date,
     current_date + 30, 'MYR', 100, 0, false, 0, 0, 100, v_admin, true,
     'QA-HRDF-SQL-TEST', 'QA HRDF SQL Contact', 'qa-hrdf-sql@example.test',
     'QA Billing Address', 'QA Training Site'),
    (v_quote_hrdf, v_opp_hrdf, 'QA-HRDF-SQL-Q-H', 1, 'sent', current_date,
     current_date + 30, 'MYR', 100, 0, false, 0, 0, 100, v_admin, true,
     'QA-HRDF-SQL-TEST', 'QA HRDF SQL Contact', 'qa-hrdf-sql@example.test',
     'QA Billing Address', 'QA Training Site');

  insert into public.sales_quotation_items
    (id, quotation_id, description, quantity, unit, unit_price, discount,
     sort_order, course_name_snapshot, hrdf_claim, package_includes_snapshot)
  values
    (v_item_non_hrdf, v_quote_non_hrdf, 'QA non-HRDF course', 1, 'pax', 100, 0,
     1, 'QA Commercial Course', false, '["QA certificate"]'::jsonb),
    (v_item_hrdf, v_quote_hrdf, 'QA HRDF course', 1, 'pax', 100, 0,
     1, 'QA HRDF Saved Course', true, '["QA meal", "QA certificate"]'::jsonb);

  perform public.accept_quotation(v_quote_non_hrdf);
  perform public.accept_quotation(v_quote_hrdf);
  v_non_hrdf_invoice := public.create_invoice_from_quotation(v_quote_non_hrdf);
  v_hrdf_invoice := public.create_invoice_from_quotation(v_quote_hrdf);

  insert into qa_context
    (admin_id, non_hrdf_invoice_id, hrdf_invoice_id, payment_reference)
  values (v_admin, v_non_hrdf_invoice, v_hrdf_invoice, 'QA-HRDF-SQL-PAY-001');
end
$$;

-- TEST 1: a non-HRDF invoice is not claim-eligible.
do $$
declare v_invoice uuid; v_error text;
begin
  select non_hrdf_invoice_id into v_invoice from qa_context;
  begin
    perform public.create_hrdf_claim_for_invoice(v_invoice);
    raise exception 'assertion_failed: non-HRDF claim creation unexpectedly succeeded';
  exception when others then
    v_error := sqlerrm;
    if v_error like 'assertion_failed:%' then raise; end if;
    if v_error <> 'hrdf_not_applicable' then
      raise exception 'assertion_failed: expected hrdf_not_applicable, got %', v_error;
    end if;
  end;
  if exists (select 1 from public.hrdf_claims where invoice_id = v_invoice) then
    raise exception 'assertion_failed: non-HRDF claim row exists';
  end if;
end
$$;

-- TEST 2 and 4: eligible creation and invoice/item snapshots.
do $$
declare v_invoice uuid; v_claim uuid; v_snapshot jsonb; v_invoice_no text;
begin
  select hrdf_invoice_id into v_invoice from qa_context;
  v_claim := public.create_hrdf_claim_for_invoice(v_invoice);
  update qa_context set claim_id = v_claim;
  if (select status from public.hrdf_claims where id = v_claim) <> 'grant_pending' then
    raise exception 'assertion_failed: initial claim status is not grant_pending';
  end if;
  if (select count(*) from public.hrdf_claims where invoice_id = v_invoice) <> 1 then
    raise exception 'assertion_failed: eligible invoice does not have exactly one claim';
  end if;
  select invoice_number_snapshot, hrdf_items_snapshot into v_invoice_no, v_snapshot
  from public.hrdf_claims where id = v_claim;
  if v_invoice_no is null or v_snapshot is null then
    raise exception 'assertion_failed: claim snapshots are not populated';
  end if;
  if v_invoice_no <> (select invoice_no from public.invoices where id = v_invoice)
     or (select invoice_total_snapshot from public.hrdf_claims where id = v_claim) <> 100
     or (select currency from public.hrdf_claims where id = v_claim) <> 'MYR'
     or v_snapshot->0->>'course_name_snapshot' <> 'QA HRDF Saved Course'
     or (v_snapshot->0->>'hrdf_claim')::boolean is distinct from true
     or v_snapshot->0->'package_includes_snapshot' <> '["QA meal", "QA certificate"]'::jsonb
  then raise exception 'assertion_failed: HRDF item or invoice snapshot mismatch'; end if;
end
$$;

-- TEST 3 and 5: duplicate claim and invalid transition.
do $$
declare v_claim uuid; v_invoice uuid; v_error text;
begin
  select claim_id, hrdf_invoice_id into v_claim, v_invoice from qa_context;
  begin
    perform public.create_hrdf_claim_for_invoice(v_invoice);
    raise exception 'assertion_failed: duplicate claim unexpectedly succeeded';
  exception when others then
    v_error := sqlerrm;
    if v_error like 'assertion_failed:%' then raise; end if;
    if v_error <> 'hrdf_claim_already_exists' then
      raise exception 'assertion_failed: expected duplicate claim error, got %', v_error;
    end if;
  end;
  if (select count(*) from public.hrdf_claims where invoice_id = v_invoice) <> 1 then
    raise exception 'assertion_failed: duplicate claim changed cardinality';
  end if;
  begin
    perform public.transition_hrdf_claim(v_claim, 'claim_submitted', '{}'::jsonb);
    raise exception 'assertion_failed: invalid transition unexpectedly succeeded';
  exception when others then
    v_error := sqlerrm;
    if v_error like 'assertion_failed:%' then raise; end if;
    if v_error <> 'invalid_hrdf_claim_transition' then
      raise exception 'assertion_failed: expected invalid transition error, got %', v_error;
    end if;
  end;
end
$$;

-- TEST 6: grant approval requires all grant fields.
do $$
declare v_claim uuid; v_error text;
begin
  select claim_id into v_claim from qa_context;
  begin
    perform public.transition_hrdf_claim(v_claim, 'grant_approved', '{}'::jsonb);
    raise exception 'assertion_failed: incomplete grant approval unexpectedly succeeded';
  exception when others then
    v_error := sqlerrm;
    if v_error like 'assertion_failed:%' then raise; end if;
    if v_error <> 'grant_approval_fields_required' then
      raise exception 'assertion_failed: expected grant field error, got %', v_error;
    end if;
  end;
  perform public.transition_hrdf_claim(v_claim, 'grant_approved',
    '{"grant_reference":"QA-HRDF-SQL-GRANT","grant_approved_date":"2026-09-11","grant_amount":80}'::jsonb);
  if (select status from public.hrdf_claims where id = v_claim) <> 'grant_approved' then
    raise exception 'assertion_failed: valid grant approval did not transition';
  end if;
end
$$;

-- TEST 7: controlled training path; no attendance data is required in Phase 1.
do $$
declare v_claim uuid;
begin
  select claim_id into v_claim from qa_context;
  perform public.transition_hrdf_claim(v_claim, 'training_in_progress', '{}'::jsonb);
  perform public.transition_hrdf_claim(v_claim, 'training_completed', '{}'::jsonb);
  perform public.transition_hrdf_claim(v_claim, 'claim_ready', '{}'::jsonb);
  if (select status from public.hrdf_claims where id = v_claim) <> 'claim_ready' then
    raise exception 'assertion_failed: training path did not reach claim_ready';
  end if;
end
$$;

-- TEST 8 and 9: claim submission and approval guards.
do $$
declare v_claim uuid; v_error text;
begin
  select claim_id into v_claim from qa_context;
  begin
    perform public.transition_hrdf_claim(v_claim, 'claim_submitted', '{}'::jsonb);
    raise exception 'assertion_failed: incomplete claim submission unexpectedly succeeded';
  exception when others then
    v_error := sqlerrm;
    if v_error like 'assertion_failed:%' then raise; end if;
    if v_error <> 'claim_submission_fields_required' then
      raise exception 'assertion_failed: expected claim field error, got %', v_error;
    end if;
  end;
  perform public.transition_hrdf_claim(v_claim, 'claim_submitted',
    '{"claim_reference":"QA-HRDF-SQL-CLAIM","claim_submitted_date":"2026-09-11","claim_amount":80}'::jsonb);
  begin
    perform public.transition_hrdf_claim(v_claim, 'claim_approved',
      '{"claim_approved_date":"2026-09-11","approved_amount":81}'::jsonb);
    raise exception 'assertion_failed: excessive approved amount unexpectedly succeeded';
  exception when others then
    v_error := sqlerrm;
    if v_error like 'assertion_failed:%' then raise; end if;
    if v_error <> 'approved_amount_invalid' then
      raise exception 'assertion_failed: expected approved amount error, got %', v_error;
    end if;
  end;
  perform public.transition_hrdf_claim(v_claim, 'claim_approved',
    '{"claim_approved_date":"2026-09-11","approved_amount":80}'::jsonb);
  if (select status from public.hrdf_claims where id = v_claim) <> 'claim_approved' then
    raise exception 'assertion_failed: valid claim approval did not transition';
  end if;
end
$$;

-- TEST 10 and 11: approval does not settle an invoice; HRDF payment uses the
-- existing payment engine and creates an HRDF-linked payment.
do $$
declare v_claim uuid; v_invoice uuid; v_result jsonb; v_payment_id uuid;
begin
  select claim_id, hrdf_invoice_id into v_claim, v_invoice from qa_context;
  if (select status from public.invoices where id = v_invoice) = 'paid' then
    raise exception 'assertion_failed: claim approval changed invoice to paid';
  end if;
  v_result := public.record_hrdf_payment(v_claim, 40, 'bank_transfer', 'online', current_date,
    'QA-HRDF-SQL-PAY-001', 'transactional behavior test');
  v_payment_id := (v_result->>'payment_id')::uuid;
  if not exists (select 1 from public.invoice_payments where id = v_payment_id
    and invoice_id = v_invoice and payment_source = 'hrdf'
    and hrdf_claim_id = v_claim and amount = 40) then
    raise exception 'assertion_failed: HRDF payment link is incorrect';
  end if;
  if (select status from public.invoices where id = v_invoice) <> 'partially_paid' then
    raise exception 'assertion_failed: partial HRDF payment did not produce partially_paid';
  end if;
end
$$;

-- TEST 12 and 13: duplicate references and excessive payments do not add rows.
do $$
declare v_claim uuid; v_payment_count integer; v_error text;
begin
  select claim_id into v_claim from qa_context;
  select count(*) into v_payment_count from public.invoice_payments where hrdf_claim_id = v_claim;
  begin
    perform public.record_hrdf_payment(v_claim, 1, 'bank_transfer', 'online', current_date,
      'QA-HRDF-SQL-PAY-001', 'duplicate reference');
    raise exception 'assertion_failed: duplicate payment reference unexpectedly succeeded';
  exception when others then
    v_error := sqlerrm;
    if v_error like 'assertion_failed:%' then raise; end if;
    if v_error <> 'duplicate_hrdf_payment_reference' then
      raise exception 'assertion_failed: expected duplicate payment error, got %', v_error;
    end if;
  end;
  begin
    perform public.record_hrdf_payment(v_claim, 50, 'bank_transfer', 'online', current_date,
      'QA-HRDF-SQL-PAY-002', 'excessive payment');
    raise exception 'assertion_failed: excessive payment unexpectedly succeeded';
  exception when others then
    v_error := sqlerrm;
    if v_error like 'assertion_failed:%' then raise; end if;
    if v_error <> 'payment_exceeds_approved_amount' then
      raise exception 'assertion_failed: expected excessive payment error, got %', v_error;
    end if;
  end;
  if (select count(*) from public.invoice_payments where hrdf_claim_id = v_claim) <> v_payment_count then
    raise exception 'assertion_failed: rejected payment changed payment cardinality';
  end if;
end
$$;

-- TEST 14: ACL/RLS metadata and historical source-of-truth protections.
do $$
declare v_rpc regprocedure;
begin
  foreach v_rpc in array array[
    'create_hrdf_claim_for_invoice(uuid)'::regprocedure,
    'transition_hrdf_claim(uuid,text,jsonb)'::regprocedure,
    'record_hrdf_payment(uuid,numeric,text,text,date,text,text)'::regprocedure
  ] loop
    if has_function_privilege('anon', v_rpc, 'EXECUTE')
       or has_function_privilege('public', v_rpc, 'EXECUTE')
       or not has_function_privilege('authenticated', v_rpc, 'EXECUTE') then
      raise exception 'assertion_failed: unsafe HRDF mutation RPC ACL for %', v_rpc;
    end if;
  end loop;
  if not (select relrowsecurity from pg_class where oid = 'public.hrdf_claims'::regclass) then
    raise exception 'assertion_failed: hrdf_claims RLS is disabled';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('create_hrdf_claim_for_invoice','transition_hrdf_claim','record_hrdf_payment')
      and pg_get_functiondef(p.oid) ilike '%course_commercial_profiles%'
  ) then
    raise exception 'assertion_failed: HRDF RPC reads live course profile state';
  end if;
end
$$;

rollback;
