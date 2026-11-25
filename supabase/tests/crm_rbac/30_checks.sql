-- Extra RBAC checks per stage (ACL, onboarding, data minimisation, financial invariants, certificate dependencies).
-- Usage (inside the stage transaction, after 10_seed.sql and 20_matrix.sql): select rbac_test.checks('<stage>');
\set ON_ERROR_STOP on

create or replace function rbac_test.ck(p_name text, p_ok boolean, p_detail text default '') returns void language plpgsql as $$
begin raise notice 'CHECK % % %', case when p_ok then 'PASS' else 'FAIL' end, p_name, p_detail; end $$;

create or replace function rbac_test.finance_flow() returns text language plpgsql as $ff$
declare v_inv uuid := (select id from rbac_test.ids where k = 'inv_issued'); j1 jsonb; j2 jsonb; out text; v text;
begin
  j1 := public.record_manual_payment(v_inv, 'bank_transfer', 'online_transfer', 100, current_date, 'RBAC-G1', null, '00000000-0000-4000-8000-0000000000a1'::uuid);
  j2 := public.record_manual_payment(v_inv, 'bank_transfer', 'online_transfer', 100, current_date, 'RBAC-G1', null, '00000000-0000-4000-8000-0000000000a1'::uuid);
  out := 'first=' || (j1->>'outcome') || ' retry=' || (j2->>'outcome')
      || ' rows=' || (select count(*) from public.invoice_payments where invoice_id = v_inv and payment_reference = 'RBAC-G1')
      || ' balance=' || (select balance_due from public.invoices where id = v_inv);
  begin perform public.record_manual_payment(v_inv, 'bank_transfer', 'online_transfer', 50, current_date, 'rbac g1', null, '00000000-0000-4000-8000-0000000000a2'::uuid);
        v := 'ok'; exception when others then v := 'err(' || sqlstate || ')'; end;
  out := out || ' dupref=' || v;
  begin perform public.record_manual_payment(v_inv, 'bank_transfer', 'online_transfer', 5000, current_date, 'RBAC-OVER', null, '00000000-0000-4000-8000-0000000000a4'::uuid);
        v := 'ok'; exception when others then v := 'err(' || sqlstate || ')'; end;
  out := out || ' over=' || v;
  begin perform public.generate_receipt_for_payment((j1->>'payment_id')::uuid); v := 'ok';
        exception when others then v := 'err(' || sqlstate || ':' || left(sqlerrm, 60) || ')'; end;
  return out || ' receipt=' || v;
end $ff$;
grant execute on function rbac_test.finance_flow() to authenticated;

create or replace function rbac_test.checks(p_stage text) returns void language plpgsql as $$
declare
  post_a boolean := p_stage in ('A', 'B', 'C', 'D');
  post_b boolean := p_stage in ('B', 'C', 'D');
  post_c boolean := p_stage in ('C', 'D');
  r text; r2 text; v_uid uuid := 'aaaaaaaa-0000-4000-8000-0000000000ee'; v_n int; v_pay uuid; v_bal numeric;
  h1 text[] := array['public.verify_public_registration_manual_payment(text,text,numeric,text,text,uuid)', 'public.finalize_public_registration_crm(uuid)'];
  s text;
begin
  -- H1 / M-01: effective ACL.
  foreach s in array h1 loop
    perform rbac_test.ck('acl_authenticated_' || split_part(split_part(s, '.', 2), '(', 1),
      has_function_privilege('authenticated', s, 'EXECUTE') = not post_a, 'authenticated EXECUTE expected ' || (not post_a)::text);
    perform rbac_test.ck('acl_service_role_' || split_part(split_part(s, '.', 2), '(', 1), has_function_privilege('service_role', s, 'EXECUTE'));
    perform rbac_test.ck('acl_anon_' || split_part(split_part(s, '.', 2), '(', 1), not has_function_privilege('anon', s, 'EXECUTE'));
  end loop;
  -- ToyyibPay callback path (service_role -> SECURITY DEFINER wrapper -> finalize_public_registration_crm as owner).
  r := rbac_test.probe('SR', $q$select public.finalize_public_registration_payment_from_callback('00000000-0000-4000-8000-0000000000fe', 'BILL', 1, 'TXN', now(), '{}'::jsonb)::text$q$);
  perform rbac_test.ck('callback_service_role_reaches_body', r !~* 'permission denied', r);
  r := rbac_test.probe('SR', $q$select public.finalize_public_registration_crm('00000000-0000-4000-8000-0000000000fd')::text$q$);
  perform rbac_test.ck('finalize_crm_service_role_execute', r !~* 'permission denied', r);
  -- Nested owner-context call: a SECURITY DEFINER function owned by postgres may still call finalize_* after M-01.
  create or replace function rbac_test.nested_finalize() returns text language plpgsql security definer set search_path = pg_catalog, public as
    $f$ begin perform public.finalize_public_registration_crm('00000000-0000-4000-8000-0000000000fc'); return 'ok'; exception when others then return sqlstate || ':' || sqlerrm; end $f$;
  grant execute on function rbac_test.nested_finalize() to service_role;
  r := rbac_test.probe('SR', 'select rbac_test.nested_finalize()');
  perform rbac_test.ck('nested_owner_call_not_permission_denied', r !~* 'permission denied', r);
  -- Public registration entry points unchanged.
  perform rbac_test.ck('create_public_registration_service_role_only',
    has_function_privilege('service_role', 'public.create_public_registration(uuid,text,text,jsonb)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.create_public_registration(uuid,text,text,jsonb)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.create_public_registration(uuid,text,text,jsonb)', 'EXECUTE'));
  perform rbac_test.ck('get_public_registration_status_anon', has_function_privilege('anon', 'public.get_public_registration_status(text,text)', 'EXECUTE'));

  -- *_unguarded stay postgres-only; can_module ACL.
  select count(*) into v_n from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like '%\_unguarded'
    and (has_function_privilege('authenticated', p.oid, 'EXECUTE') or has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('service_role', p.oid, 'EXECUTE'));
  perform rbac_test.ck('unguarded_not_client_callable', v_n = 0, v_n || ' client-callable');
  if post_b then
    perform rbac_test.ck('can_module_acl', has_function_privilege('authenticated', 'app.can_module(text,text)', 'EXECUTE')
      and not has_function_privilege('anon', 'app.can_module(text,text)', 'EXECUTE')
      and (select prosecdef and provolatile = 's' and array_to_string(proconfig, ',') = 'search_path=pg_catalog, public' from pg_proc where oid = 'app.can_module(text,text)'::regprocedure));
  end if;
  if post_c then
    select count(*) into v_n from pg_proc where pronamespace = 'public'::regnamespace and proname like '%\_unguarded'
      and prosrc ~ 'if not app\.is_admin\(\) then';
    perform rbac_test.ck('m05_no_admin_only_gate_left', v_n = 0, v_n || ' left');
    select count(*) into v_n from pg_proc where pronamespace = 'public'::regnamespace and proname like '%\_unguarded'
      and (length(prosrc) - length(replace(prosrc, 'app.can_module(', ''))) / length('app.can_module(') between 1 and 2;
    perform rbac_test.ck('m05_gates_use_can_module', v_n = 17, v_n || '/17');
    perform rbac_test.ck('mark_lead_test_super_admin_only_kept',
      (select prosrc ~ 'current_role\(\) <> ''super_admin''' from pg_proc where oid = 'public.mark_lead_test_unguarded(uuid,boolean)'::regprocedure));
  end if;

  -- M-03 onboarding: a user created outside the UI (or whose provisioning stopped) gets no access after M-03.
  insert into auth.users (id, email, aud, role) values (v_uid, 'new@rbac.invalid', 'authenticated', 'authenticated');
  insert into rbac_test.persona values ('NU', v_uid, 'editor', true, null, '{}', 'new, unprovisioned');
  perform rbac_test.ck('onboarding_profile_created_editor', (select role = 'editor' and is_active from public.profiles where id = v_uid));
  perform rbac_test.ck('onboarding_acl_default', (select access_control_enabled from public.profiles where id = v_uid) = post_b,
    'access_control_enabled = ' || (select access_control_enabled from public.profiles where id = v_uid)::text);
  r := rbac_test.probe('NU', $q$select public.has_module_access_level('sales_leads', 'view')::text$q$);
  perform rbac_test.ck('onboarding_unprovisioned_module_access', (r = 'ok:true') = (not post_b), r || case when post_b then ' (expected no access)' else ' (pre-M-03 gap: role-default access)' end);
  r := rbac_test.probe('NU', $q$select count(*)::text from public.sales_lead_metadata$q$);
  perform rbac_test.ck('onboarding_unprovisioned_reads_leads', (r <> 'ok:0') = (not post_b), r);
  -- Staff manager escalation guards (unchanged): delegated admin cannot promote or touch admins.
  r := rbac_test.probe('DA', format($q$select public.update_staff_profile(%L, null, null, 'admin', true, true)::text$q$, (select uid from rbac_test.persona where code = 'SS')));
  perform rbac_test.ck('delegated_admin_cannot_promote', rbac_test.classify(r) <> 'A', r);
  r := rbac_test.probe('DA', format($q$select public.set_staff_module_access(%L, '[{"module_key":"users","access_level":"admin"}]'::jsonb)::text$q$, (select uid from rbac_test.persona where code = 'DA')));
  perform rbac_test.ck('delegated_admin_cannot_grant_self', rbac_test.classify(r) <> 'A', r);

  -- M-07 data minimisation: the Reports RPC returns only the six reporting columns.
  if post_a then
    perform rbac_test.ck('report_rpc_columns',
      (select string_agg(x.a, ',' order by x.n) from pg_proc p, unnest(p.proargnames, p.proargmodes::text[]) with ordinality x(a, m, n)
        where p.oid = 'public.get_report_participants(integer)'::regprocedure and x.m = 't')
        = 'id,participant_id,full_name,company,status,created_at',
      (select array_to_string(proargnames, ',') from pg_proc where oid = 'public.get_report_participants(integer)'::regprocedure));
    r := rbac_test.probe('RP', 'select public.get_report_participant_count()::text');
    perform rbac_test.ck('report_count_for_reports_holder', r = 'ok:2', r);
    r := rbac_test.probe('SS', 'select coalesce(public.get_report_participant_count()::text, ''null'')');
    perform rbac_test.ck('report_count_denied_without_reports', r = 'ok:null', r);
    r := rbac_test.probe('RP', $q$select count(*)::text from public.participants$q$);
    perform rbac_test.ck('reports_holder_no_raw_participant_rows', r = 'ok:0', r);
  end if;

  -- Financial invariants exercised as Finance Staff after DB C (as the existing Finance admin before), through the
  -- real wrappers, one statement at a time (rbac_test.finance_flow runs as the persona: SECURITY INVOKER).
  r := case when post_c then 'FS' else 'LF' end;
  r2 := rbac_test.probe(r, 'select rbac_test.finance_flow()');
  perform rbac_test.ck('g1_idempotent_retry_one_payment', r2 ~ 'retry=duplicate_ignored', r || ' ' || r2);
  perform rbac_test.ck('g1_single_payment_row_and_balance', r2 ~ 'rows=1 balance=800.00', r || ' ' || r2);
  perform rbac_test.ck('g1_duplicate_reference_rejected', r2 ~ 'dupref=err', r || ' ' || r2);
  perform rbac_test.ck('overpayment_rejected', r2 ~ 'over=err', r || ' ' || r2);
  perform rbac_test.ck('receipt_for_payment', r2 ~ 'receipt=ok', r || ' ' || r2);
  r2 := rbac_test.probe(r, $q$update public.invoices set grand_total = 1 where id = (select id from rbac_test.ids where k = 'inv_issued')$q$);
  perform rbac_test.ck('issued_invoice_financial_immutability', rbac_test.classify(r2) <> 'A', r || ' ' || r2);
  r2 := rbac_test.probe(case when post_c then 'SS' else 'LS' end, $q$update public.sales_quotations set notes = 'x' where id = (select id from rbac_test.ids where k = 'q')$q$);
  perform rbac_test.ck('accepted_quotation_locked', rbac_test.classify(r2) <> 'A', r2);
  r2 := rbac_test.probe('SS', $q$select public.cancel_invoice((select id from rbac_test.ids where k = 'inv'), 'x')::text$q$);
  perform rbac_test.ck('sales_staff_cannot_cancel_invoice', rbac_test.classify(r2) = 'D', r2);
  r2 := rbac_test.probe('FS', $q$update public.sales_quotations set notes = 'x' where id = (select id from rbac_test.ids where k = 'q2')$q$);
  perform rbac_test.ck('finance_staff_quotation_view_only', rbac_test.classify(r2) = 'D', r2);
  r2 := rbac_test.probe('FS', $q$select count(*)::text from public.sales_quotations$q$);
  perform rbac_test.ck('finance_staff_can_read_quotations', r2 <> 'ok:0', r2);
  r2 := rbac_test.probe('SS', $q$select count(*)::text from public.invoices$q$);
  perform rbac_test.ck('sales_staff_no_invoice_rows', r2 = 'ok:0', r2);

  -- Certificate / Training dependencies: no SECURITY INVOKER function other than the seat-sync trigger writes the
  -- tables M-09 narrows, so certificate issuance and verification paths are unaffected.
  select count(*) into v_n from pg_proc p where p.pronamespace in ('public'::regnamespace, 'app'::regnamespace) and not p.prosecdef
    and p.proname <> 'sync_schedule_seats'
    and p.prosrc ~* '(insert\s+into|update|delete\s+from)\s+(public\.)?(participants|schedule_participants|course_schedules|attendance|assessments|participant_skill_results|certificate_templates|course_commercial_profiles|legacy_course_map|legacy_import_batches|legacy_participant_staging|certificate_import_logs|courses)\M';
  perform rbac_test.ck('no_invoker_writer_of_narrowed_tables', v_n = 0, v_n || ' found');
  perform rbac_test.ck('verify_certificate_public_rpc_unchanged',
    not has_function_privilege('anon', 'public.verify_certificate(text)', 'EXECUTE') and has_function_privilege('service_role', 'public.verify_certificate(text)', 'EXECUTE'));
  r2 := rbac_test.probe('SA', $q$insert into public.schedule_participants (schedule_id, participant_id) values ((select id from rbac_test.ids where k = 'sched'), (select id from rbac_test.ids where k = 'p2'))$q$);
  perform rbac_test.ck('super_admin_enrolment_with_seat_sync', r2 = 'ok:1', r2);
  perform rbac_test.ck('catalog_unchanged', (select count(*) from public.staff_module_catalog) = 40);
end $$;
