-- RBAC persona matrix: actual capability (RLS, RPC EXECUTE, function gates) per persona, compared with expectations
-- fixed in advance. Every probe runs in its own subtransaction that is always rolled back, as the persona
-- (request.jwt claims + SET LOCAL ROLE authenticated/anon/service_role) - i.e. exactly what PostgREST does for a direct
-- API call with that user's token. Usage (inside a transaction, after 10_seed.sql): select rbac_test.run('<stage>');
--   stage: S0 (no RBAC migrations) | A (DB A) | B (DB A+B) | C (all nine) | D (all nine + M-10; same expectations as C)
-- Expectation codes per persona: A allowed (succeeds, affects/returns >=1) | D denied (authorization error, or 0 rows)
--   P passes authorization (success or a business-rule error) | N not allowed to succeed (D or business error) | - skip
\set ON_ERROR_STOP on

create or replace function rbac_test.probe(p_code text, p_sql text) returns text language plpgsql as $$
declare v text; n bigint;
begin
  begin
    perform rbac_test.claims(p_code);
    execute format('set local role %I', case p_code when 'AN' then 'anon' when 'SR' then 'service_role' else 'authenticated' end);
    if p_sql ~* '^\s*(insert|update|delete)' then execute p_sql; else execute p_sql into v; end if;
    get diagnostics n = row_count;
    raise exception using errcode = 'RB000', message = coalesce(nullif(v, ''), n::text);
  exception
    when sqlstate 'RB000' then return 'ok:' || sqlerrm;
    when others then return 'err:' || sqlstate || ':' || left(sqlerrm, 120);
  end;
end $$;

create or replace function rbac_test.classify(p_res text) returns text language sql immutable as $$
  select case
    when p_res like 'ok:%' then case when substr(p_res, 4) in ('0', 'f', 'false', '') then 'D' else 'A' end
    when p_res ~* '^err:42501' or p_res ~* '(forbidden|not_authorized|not authorized|permission denied|row-level security|inactive)' then 'D'
    else 'X' end;
$$;

create table if not exists rbac_test.cases (id text primary key, grp text, layer text, descr text, sql text, pre text, post text);
truncate rbac_test.cases;
-- Persona order in pre/post strings: SA DA SS FS MG RD CE VO NG MD TR IN LS LF LM AN
insert into rbac_test.cases values
 ('T01','widen','RLS','UPDATE sales_lead_metadata (lead)',
  $s$update public.sales_lead_metadata set priority = 'high' where id = (select id from rbac_test.ids where k = 'lead')$s$,
  'ADDDDDDDDDDDADDD', 'ADADDDDDDADDADDD'),
 ('T02','widen','RLS','INSERT sales_quotations (draft, open opportunity)',
  $s$insert into public.sales_quotations (opportunity_id, customer_company_name, status) values ((select id from rbac_test.ids where k = 'opp_open'), 'X', 'draft')$s$,
  'ADDDDDDDDDDDADDD', 'ADADDDADDADDADDD'),
 ('T03','widen','RLS','UPDATE sales_quotations (draft q2)',
  $s$update public.sales_quotations set notes = 'rbac' where id = (select id from rbac_test.ids where k = 'q2')$s$,
  'ADDDDDDDDDDDADDD', 'ADADDDADDADDADDD'),
 ('T04','widen','RLS','INSERT sales_quotation_items (q2)',
  $s$insert into public.sales_quotation_items (quotation_id, description, quantity, unit_price) values ((select id from rbac_test.ids where k = 'q2'), 'x', 1, 1)$s$,
  'ADDDDDDDDDDDADDD', 'ADADDDADDADDADDD'),
 ('T05','widen','RLS','DELETE sales_quotation_items (q2)',
  $s$delete from public.sales_quotation_items where quotation_id = (select id from rbac_test.ids where k = 'q2')$s$,
  'ADDDDDDDDDDDADDD', 'ADADDDADDADDADDD'),
 ('T06','widen','RPC','accept_quotation(q3)',
  $s$select public.accept_quotation((select id from rbac_test.ids where k = 'q3'))::text$s$,
  'ADDDDDDDDDDDADDD', 'ADADDDADDADDADDD'),
 ('T07','widen','RLS','INSERT sales_opportunities directly (API path; the app uses convert_lead_to_opportunity)',
  $s$insert into public.sales_opportunities (lead_metadata_id, title) values ((select id from rbac_test.ids where k = 'lead2'), 'x')$s$,
  'ADDDDDDDDDDDADDD', 'ADADDDDDDADDADDD'),
 ('T08','widen','RPC','convert_lead_to_opportunity(lead2)',
  $s$select public.convert_lead_to_opportunity((select id from rbac_test.ids where k = 'lead2'), 'x', current_date + 10, 10)::text$s$,
  'ADDDDDDDDDDDADDD', 'ADADDDDDDADDADDD'),
 ('T09','widen','RPC','create_invoice_from_quotation(q4 accepted)',
  $s$select public.create_invoice_from_quotation((select id from rbac_test.ids where k = 'q4'))::text$s$,
  'ADDDDDDDDDDDDADD', 'ADDADDDDDDDDDADD'),
 ('T10','widen','RPC','issue_invoice(draft invoice)',
  $s$select public.issue_invoice((select id from rbac_test.ids where k = 'inv'))::text$s$,
  'ADDDDDDDDDDDDADD', 'ADDADDDDDDDDDADD'),
 ('T11','widen','RPC','record_manual_payment (G1 idempotency key) on issued invoice',
  $s$select public.record_manual_payment((select id from rbac_test.ids where k = 'inv_issued'), 'bank_transfer', 'online_transfer', 100, current_date, 'RBAC-REF-1', null, '00000000-0000-4000-8000-0000000000ab'::uuid)::text$s$,
  'ADDDDDDDDDDDDADD', 'ADDADDDDDDDDDADD'),
 ('T12','widen','RLS','UPDATE invoices (draft notes)',
  $s$update public.invoices set notes = 'rbac' where id = (select id from rbac_test.ids where k = 'inv')$s$,
  'ADDDDDDDDDDDDADD', 'ADDADDDDDDDDDADD'),
 ('T13','widen','RPC','create_hrdf_claim_for_invoice(issued invoice)',
  $s$select public.create_hrdf_claim_for_invoice((select id from rbac_test.ids where k = 'inv_issued'))::text$s$,
  'PDDDDDDDDDDDDPDD', 'PDDPDDDDDDDDDPDD'),
 ('T14','same','RLS','UPDATE own sales task (assigned to SS)',
  $s$update public.sales_tasks set title = 'x' where id = (select id from rbac_test.ids where k = 'task_ss')$s$,
  'ADADDDDDDDDDADDD', 'ADADDDDDDDDDADDD'),
 ('T15','same','RLS','UPDATE another user''s sales task (invariant: editors own tasks only)',
  $s$update public.sales_tasks set title = 'x' where id = (select id from rbac_test.ids where k = 'task_sa')$s$,
  'ADDDDDDDDDDDADDD', 'ADDDDDDDDDDDADDD'),
 ('T16','same','RLS','DELETE sales task (finding: authenticated has no DELETE privilege on sales_tasks in Production - inert for everyone)',
  $s$delete from public.sales_tasks where id = (select id from rbac_test.ids where k = 'task_ss')$s$,
  'DDDDDDDDDDDDDDDD', 'DDDDDDDDDDDDDDDD'),
 ('T17','narrow','RLS','SELECT invoice_items (M-06)',
  $s$select count(*)::text from public.invoice_items$s$,
  'AAAAAAAAAADDAAAD', 'ADDADADADADDDADD'),
 ('T18','narrow','RLS','SELECT participants (M-07; MG/LM via feedback View and LS/LF via companies View remain - documented residual)',
  $s$select count(*)::text from public.participants$s$,
  'AAAAAAAAAADDAAAD', 'ADDDAADADDDDAAAD'),
 ('T19','narrow','RPC','get_report_participants() minimum columns (M-07)',
  $s$select count(*)::text from public.get_report_participants(5)$s$,
  '----------------', 'ADDDAADDDDDDDDAD'),
 ('T20','narrow','RLS','SELECT audit_logs (M-08)',
  $s$select count(*)::text from public.audit_logs$s$,
  'AADDDDDDDDDDDDAD', 'AADDDDDDDDDDDDDD'),
 ('T21','narrow','RLS','UPDATE participants (M-09)',
  $s$update public.participants set company = 'x' where id = (select id from rbac_test.ids where k = 'p')$s$,
  'AADDDDDDDDDDAAAD', 'ADDDDDDDDDDDDDDD'),
 ('T22','narrow','RLS','DELETE participant with attendance/assessment/enrolment (cascade path, M-09)',
  $s$delete from public.participants where id = (select id from rbac_test.ids where k = 'p')$s$,
  'AADDDDDDDDDDAAAD', 'ADDDDDDDDDDDDDDD'),
 ('T23','narrow','RLS','INSERT participants (M-09)',
  $s$insert into public.participants (full_name) values ('x')$s$,
  'AADDDDDDDDDDAAAD', 'ADDDDDDDDDDDDDDD'),
 ('T24','narrow','RLS','UPDATE course_schedules (M-09)',
  $s$update public.course_schedules set capacity = 21 where id = (select id from rbac_test.ids where k = 'sched')$s$,
  'AADDDDDDDDDDAAAD', 'ADDDDDDDDDDDDDDD'),
 ('T25','narrow','RLS','DELETE course_schedules (cascade into assessments is stopped by the assessment-integrity trigger; M-09 denies earlier)',
  $s$delete from public.course_schedules where id = (select id from rbac_test.ids where k = 'sched')$s$,
  'PPDDDDDDDDDDPPPD', 'PDDDDDDDDDDDDDDD'),
 ('T26','narrow','RLS','INSERT schedule_participants (seat-sync trigger, M-09)',
  $s$insert into public.schedule_participants (schedule_id, participant_id) values ((select id from rbac_test.ids where k = 'sched'), (select id from rbac_test.ids where k = 'p2'))$s$,
  'AADDDDDDDDDDAAAD', 'ADDDDDDDDDDDDDDD'),
 ('T27','narrow','RLS','INSERT attendance (trainer branch unchanged, M-09)',
  $s$insert into public.attendance (schedule_id, participant_id, session_date, attendance_status) values ((select id from rbac_test.ids where k = 'sched'), (select id from rbac_test.ids where k = 'p'), current_date + 1, 'present')$s$,
  'AADDDDDDDDADAAAD', 'ADDDDDDDDDADDDDD'),
 ('T28','narrow','RLS','UPDATE assessments (unlocked, M-09)',
  $s$update public.assessments set result = 'pass' where participant_id = (select id from rbac_test.ids where k = 'p')$s$,
  'AADDDDDDDDADAAAD', 'ADDDDDDDDDADDDDD'),
 ('T29','narrow','RLS','DELETE assessments (M-09)',
  $s$delete from public.assessments where participant_id = (select id from rbac_test.ids where k = 'p')$s$,
  'AADDDDDDDDDDAAAD', 'ADDDDDDDDDDDDDDD'),
 ('T30','narrow','RLS','UPDATE certificate_templates (M-09)',
  $s$update public.certificate_templates set description = 'x' where id = '00000000-0000-4000-8000-00000000c0de'$s$,
  'AADDDDDDDDDDAAAD', 'ADDDDDDDDDDDDDDD'),
 ('T31','narrow','RLS','INSERT legacy_import_batches (M-09)',
  $s$insert into public.legacy_import_batches (original_filename, source_label) values ('f.csv', 'x')$s$,
  'AADDDDDDDDDDAAAD', 'ADDDDDDDDDDDDDDD'),
 ('T32','narrow','RPC','legacy_import_create_batch (M-09 gate)',
  $s$select public.legacy_import_create_batch('x', 'f.csv', null)::text$s$,
  'PPDDDDDDDDDDPPPD', 'PDDDDDDDDDDDDDDD'),
 ('T33','narrow','RLS','DELETE courses (no audit trigger, M-09)',
  $s$delete from public.courses where id = (select id from rbac_test.ids where k = 'course2')$s$,
  'AADDDDDDDDDDAAAD', 'ADDDDDDDDDDDDDDD'),
 ('T34','narrow','RLS','DELETE news_posts (M-09)',
  $s$delete from public.news_posts where id = (select id from rbac_test.ids where k = 'news')$s$,
  'AADDDDDDDDDDAAAD', 'ADDDDDDDDDDDDDDD'),
 ('T35','narrow','RPC','verify_public_registration_manual_payment (H1, M-01)',
  $s$select public.verify_public_registration_manual_payment('RBAC-NOPE', 'secret', 1, 'R', null, auth.uid())::text$s$,
  'PPDDDDDDDDDDPPPD', 'DDDDDDDDDDDDDDDD'),
 ('T36','narrow','RPC','finalize_public_registration_crm (H1, M-01)',
  $s$select public.finalize_public_registration_crm('00000000-0000-4000-8000-0000000000ff')::text$s$,
  'PPDDDDDDDDDDPPPD', 'DDDDDDDDDDDDDDDD'),
 ('T37','same','RPC','escalation: set_staff_module_access on self',
  $s$select public.set_staff_module_access(auth.uid(), '[{"module_key":"users","access_level":"admin"}]'::jsonb)::text$s$,
  'PNNNNNNNNNNNNNNN', 'PNNNNNNNNNNNNNNN'),
 ('T38','same','RLS','escalation: UPDATE own profile role',
  $s$update public.profiles set role = 'super_admin' where id = auth.uid()$s$,
  'NNNNNNNNNNNNNNNN', 'NNNNNNNNNNNNNNNN'),
 ('T39','same','RLS','escalation: UPDATE own access_control_enabled',
  $s$update public.profiles set access_control_enabled = false where id = auth.uid()$s$,
  'NNNNNNNNNNNNNNNN', 'NNNNNNNNNNNNNNNN'),
 ('T40','same','RPC','escalation: call an *_unguarded function directly',
  $s$select public.accept_quotation_unguarded((select id from rbac_test.ids where k = 'q3'))::text$s$,
  'DDDDDDDDDDDDDDDD', 'DDDDDDDDDDDDDDDD'),
 ('T41','cm','RPC','app.can_module(sales_quotations, edit)',
  $s$select app.can_module('sales_quotations', 'edit')::text$s$,
  '----------------', 'ADADDDADDADDADDD'),
 ('T42','cm','RPC','app.can_module invalid level / unknown module / NULLs (fail closed)',
  $s$select (coalesce(app.can_module('sales_quotations', 'bogus'), false)::int + coalesce(app.can_module('no_such_module', 'view'), false)::int
            + coalesce(app.can_module(null, 'view'), false)::int + coalesce(app.can_module('sales_quotations', null), false)::int)::text$s$,
  '----------------', 'DDDDDDDDDDDDDDDD'),
 ('T43','widen','RPC','create_internal_sales_lead (editor gate, not changed by this work)',
  $s$select public.create_internal_sales_lead('Probe', 'probe@rbac.invalid', null, null, null, null, null, null, null)::text$s$,
  'ADADDADDDADDADDD', 'ADADDADDDADDADDD');

create or replace function rbac_test.run(p_stage text) returns table (pass int, fail int) language plpgsql as $$
declare
  c record; codes text[] := array['SA','DA','SS','FS','MG','RD','CE','VO','NG','MD','TR','IN','LS','LF','LM','AN'];
  i int; exp_s text; e text; got text; res text; grid text; np int := 0; nf int := 0; ok boolean;
begin
  for c in select * from rbac_test.cases order by id loop
    exp_s := case
      when p_stage = 'S0' then case when c.grp = 'cm' then repeat('-', 16) else c.pre end
      when p_stage in ('C', 'D', 'E', 'F') then c.post
      when c.grp = 'narrow' then c.post
      when c.grp = 'cm' then case when p_stage = 'B' then c.post else repeat('-', 16) end
      else c.pre end;
    grid := '';
    for i in 1..16 loop
      e := substr(exp_s, i, 1);
      if e = '-' then grid := grid || '-'; continue; end if;
      res := rbac_test.probe(codes[i], c.sql);
      got := rbac_test.classify(res);
      grid := grid || got;
      ok := case e when 'A' then got = 'A' when 'D' then got = 'D' when 'P' then got in ('A', 'X') when 'N' then got in ('D', 'X') else false end;
      if ok then np := np + 1;
      else nf := nf + 1; raise notice 'FAIL % % % expected % got % (%)', p_stage, c.id, codes[i], e, got, res; end if;
    end loop;
    raise notice 'GRID % % % | %', p_stage, c.id, grid, c.descr;
  end loop;
  raise notice 'TOTAL % pass=% fail=%', p_stage, np, nf;
  return query select np, nf;
end $$;
