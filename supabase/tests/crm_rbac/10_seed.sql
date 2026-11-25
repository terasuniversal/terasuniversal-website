-- Synthetic personas and data for the RBAC persona matrix (local Docker fixture only; no real data).
-- Runs as postgres inside the caller's transaction. Rows are created through auth.users (so app.handle_new_user runs)
-- and then shaped directly; business rows are created through the real RPCs where practical.
\set ON_ERROR_STOP on
create schema if not exists rbac_test;

create table rbac_test.persona (code text primary key, uid uuid, role public.user_role, active boolean, acl boolean, modules jsonb, note text);
insert into rbac_test.persona values
 ('SA', 'aaaaaaaa-0000-4000-8000-000000000001', 'super_admin', true,  false, '{}', 'Super Admin'),
 ('DA', 'aaaaaaaa-0000-4000-8000-000000000002', 'admin',       true,  true,  '{"users":"admin","audit":"view"}', 'Delegated Admin (staff manager)'),
 ('SS', 'aaaaaaaa-0000-4000-8000-000000000003', 'editor',      true,  true,  '{"sales":"view","sales_leads":"edit","sales_opportunities":"edit","sales_quotations":"edit","sales_followups":"edit","sales_tasks":"edit","sales_reports":"view","hrdf_claims":"view"}', 'Sales Staff preset'),
 ('FS', 'aaaaaaaa-0000-4000-8000-000000000004', 'editor',      true,  true,  '{"invoices":"edit","hrdf_claims":"edit","sales_quotations":"view","sales_reports":"view"}', 'Finance Staff preset'),
 ('MG', 'aaaaaaaa-0000-4000-8000-000000000005', 'editor',      true,  true,  '{"dashboard":"view","reports":"view","sales_reports":"view","feedback":"view","feedback_issues":"view"}', 'Management (target editor shape)'),
 ('RD', 'aaaaaaaa-0000-4000-8000-000000000006', 'editor',      true,  false, '{}', 'Editor, Role Default Access'),
 ('CE', 'aaaaaaaa-0000-4000-8000-000000000007', 'editor',      true,  true,  '{"sales_quotations":"edit","news":"edit","sales_tasks":"edit"}', 'Editor, Custom Module Access (edit)'),
 ('VO', 'aaaaaaaa-0000-4000-8000-000000000008', 'editor',      true,  true,  '{"sales_quotations":"view","sales_leads":"view","invoices":"view","participants":"view","news":"view","courses":"view"}', 'View-only staff'),
 ('NG', 'aaaaaaaa-0000-4000-8000-000000000009', 'editor',      true,  true,  '{}', 'Staff without module grants'),
 ('MD', 'aaaaaaaa-0000-4000-8000-000000000010', 'editor',      true,  true,  '{"sales":"view","sales_leads":"edit","sales_opportunities":"edit","sales_quotations":"edit","sales_followups":"edit","sales_tasks":"edit","sales_reports":"view","hrdf_claims":"view","invoices":"view"}', 'Multi-department (Sales + invoices View)'),
 ('TR', 'aaaaaaaa-0000-4000-8000-000000000011', 'trainer',     true,  false, '{}', 'Trainer'),
 ('IN', 'aaaaaaaa-0000-4000-8000-000000000012', 'editor',      false, true,  '{"invoices":"edit","hrdf_claims":"edit","sales_quotations":"view","sales_reports":"view","companies":"view","sales_leads":"edit"}', 'Inactive (former Finance)'),
 ('LS', 'aaaaaaaa-0000-4000-8000-000000000013', 'admin',       true,  true,  '{"sales":"view","sales_leads":"edit","sales_opportunities":"edit","sales_quotations":"edit","sales_followups":"edit","sales_tasks":"edit","sales_reports":"view","companies":"view"}', 'Existing departmental admin, Sales (P3 shape)'),
 ('LF', 'aaaaaaaa-0000-4000-8000-000000000014', 'admin',       true,  true,  '{"invoices":"edit","hrdf_claims":"edit","sales_quotations":"view","sales_reports":"view","companies":"view"}', 'Existing departmental admin, Finance (P5 shape)'),
 ('LM', 'aaaaaaaa-0000-4000-8000-000000000015', 'admin',       true,  true,  '{"dashboard":"view","reports":"view","sales_reports":"view","feedback":"view"}', 'Existing departmental admin, Management (P2 shape)'),
 ('AN', null, null, null, null, null, 'Anonymous'),
 ('RP', 'aaaaaaaa-0000-4000-8000-000000000016', 'editor', true, true, '{"reports":"view"}', 'Reports-only holder (checks only)');

insert into auth.users (id, email, aud, role, raw_user_meta_data)
select uid, lower(code) || '@rbac.invalid', 'authenticated', 'authenticated', jsonb_build_object('full_name', 'RBAC ' || code)
from rbac_test.persona where uid is not null;

-- Persona shape (the trigger created every profile as editor; the M-03 default applies when this runs after M-03).
alter table public.profiles disable trigger user;
update public.profiles p set role = x.role, is_active = x.active, access_control_enabled = x.acl
from rbac_test.persona x where x.uid = p.id;
alter table public.profiles enable trigger user;
insert into public.staff_module_access (user_id, module_key, access_level)
select x.uid, m.key, m.value #>> '{}' from rbac_test.persona x, jsonb_each(x.modules) m where x.uid is not null;

-- This image's auth.uid()/auth.role() read the legacy per-claim settings; Production's read request.jwt.claims.
-- Both are set so the helpers resolve the caller identically.
create or replace function rbac_test.claims(p_code text) returns void language sql as $$
  select set_config('request.jwt.claims',
           case when p_code = 'AN' then '{"role":"anon"}'
                when p_code = 'SR' then '{"role":"service_role"}'
                else json_build_object('sub', (select uid from rbac_test.persona where code = p_code), 'role', 'authenticated')::text end, true),
         set_config('request.jwt.claim.sub', coalesce((select uid::text from rbac_test.persona where code = p_code), ''), true),
         set_config('request.jwt.claim.role', case p_code when 'AN' then 'anon' when 'SR' then 'service_role' else 'authenticated' end, true);
$$;

-- Business data, created as SA through the real RPCs (SECURITY DEFINER; RLS bypassed by design inside them).
create table rbac_test.ids (k text primary key, id uuid);
create function rbac_test.new_opp(p_name text) returns uuid language sql as $f$
  select public.convert_lead_to_opportunity(public.create_internal_sales_lead(p_name, lower(replace(p_name, ' ', '')) || '@rbac.invalid', null, p_name, 'WAH', null, null, null, null), p_name, current_date + 30, 1000);
$f$;
do $seed$
declare v_lead uuid; v_opp uuid; v_q uuid; v_q2 uuid; v_q3 uuid; v_inv uuid; v_course uuid; v_sched uuid; v_p uuid; v_p2 uuid; v_task uuid; v_task2 uuid;
begin
  perform rbac_test.claims('SA');
  v_lead := public.create_internal_sales_lead('RBAC Lead', 'lead@rbac.invalid', null, 'RBAC Sdn Bhd', 'WAH', null, null, null, null);
  v_opp := public.convert_lead_to_opportunity(v_lead, 'RBAC Opp', current_date + 30, 1000);
  insert into public.sales_quotations (opportunity_id, customer_company_name, status, created_by)
    values (v_opp, 'RBAC Sdn Bhd', 'draft', 'aaaaaaaa-0000-4000-8000-000000000001') returning id into v_q;
  insert into public.sales_quotation_items (quotation_id, description, quantity, unit_price)
    values (v_q, 'WAH course', 1, 1000);
  update public.sales_quotations set subtotal = 1000, total = 1000, status = 'sent', sent_at = now() where id = v_q;
  insert into public.sales_quotations (opportunity_id, customer_company_name, status, created_by)
    values (rbac_test.new_opp('RBAC Opp B'), 'RBAC Sdn Bhd', 'draft', 'aaaaaaaa-0000-4000-8000-000000000001') returning id into v_q2;
  insert into public.sales_quotation_items (quotation_id, description, quantity, unit_price) values (v_q2, 'Spare draft', 1, 50);
  insert into public.sales_quotations (opportunity_id, customer_company_name, status, created_by)
    values ((select opportunity_id from public.sales_quotations where id = v_q2), 'RBAC Sdn Bhd', 'draft', 'aaaaaaaa-0000-4000-8000-000000000001') returning id into v_q3;
  insert into public.sales_quotation_items (quotation_id, description, quantity, unit_price) values (v_q3, 'For acceptance', 1, 500);
  update public.sales_quotations set subtotal = 500, total = 500, status = 'sent', sent_at = now() where id = v_q3;
  insert into public.sales_tasks (title, assigned_to, created_by, status, priority)
    values ('Task of SA', 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'open', 'low') returning id into v_task;
  insert into public.sales_tasks (title, assigned_to, created_by, status, priority)
    values ('Task of SS', 'aaaaaaaa-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000003', 'open', 'low') returning id into v_task2;
  insert into public.courses (course_name, title) values ('RBAC Course', 'RBAC Course') returning id into v_course;
  insert into public.course_schedules (course_id, start_date, end_date, capacity) values (v_course, current_date, current_date + 1, 20) returning id into v_sched;
  insert into public.participants (full_name, company, status) values ('RBAC Participant', 'RBAC Sdn Bhd', 'registered') returning id into v_p;
  insert into public.participants (full_name, company, status) values ('RBAC Participant Two', 'RBAC Sdn Bhd', 'registered') returning id into v_p2;
  insert into public.schedule_participants (schedule_id, participant_id, registration_status) values (v_sched, v_p, 'registered');
  insert into public.attendance (schedule_id, participant_id, session_date, attendance_status) values (v_sched, v_p, current_date, 'present');
  insert into public.assessments (schedule_id, participant_id, result) values (v_sched, v_p, 'pending');
  insert into public.audit_logs (action, entity_type, summary) values ('update', 'rbac_test', 'synthetic audit row');
  insert into rbac_test.ids values ('lead', v_lead), ('opp', v_opp), ('q', v_q), ('q2', v_q2), ('q3', v_q3), ('course', v_course),
    ('sched', v_sched), ('p', v_p), ('p2', v_p2), ('task_sa', v_task), ('task_ss', v_task2);
  -- Accepted quotation -> invoice (Finance flow input).
  perform public.accept_quotation(v_q);
  v_inv := public.create_invoice_from_quotation(v_q);
  insert into rbac_test.ids values ('inv', v_inv);
  -- q4: accepted, not yet invoiced (invoice-creation probe). q5 -> issued invoice (payment/receipt/HRDF probes).
  declare v_q4 uuid; v_q5 uuid; v_inv2 uuid; v_lead2 uuid; v_course2 uuid; v_news uuid;
  begin
    insert into public.sales_quotations (opportunity_id, customer_company_name, status, created_by, subtotal, total)
      values (rbac_test.new_opp('RBAC Opp C'), 'RBAC Sdn Bhd', 'draft', 'aaaaaaaa-0000-4000-8000-000000000001', 700, 700) returning id into v_q4;
    insert into public.sales_quotation_items (quotation_id, description, quantity, unit_price) values (v_q4, 'Q4 line', 1, 700);
    update public.sales_quotations set status = 'sent', sent_at = now() where id = v_q4;
    perform public.accept_quotation(v_q4);
    insert into public.sales_quotations (opportunity_id, customer_company_name, status, created_by, subtotal, total)
      values (rbac_test.new_opp('RBAC Opp D'), 'RBAC Sdn Bhd', 'draft', 'aaaaaaaa-0000-4000-8000-000000000001', 900, 900) returning id into v_q5;
    insert into public.sales_quotation_items (quotation_id, description, quantity, unit_price) values (v_q5, 'Q5 line', 1, 900);
    update public.sales_quotations set status = 'sent', sent_at = now() where id = v_q5;
    perform public.accept_quotation(v_q5);
    v_inv2 := public.create_invoice_from_quotation(v_q5);
    perform public.issue_invoice(v_inv2);
    v_lead2 := public.create_internal_sales_lead('RBAC Lead Two', 'lead2@rbac.invalid', null, 'RBAC Two', 'WAH', null, null, null, null);
    insert into public.courses (course_name, title) values ('RBAC Course Two', 'RBAC Course Two') returning id into v_course2;
    insert into public.news_posts (slug, title) values ('rbac-news', 'RBAC news') returning id into v_news;
    insert into rbac_test.ids values ('q4', v_q4), ('opp_open', (select opportunity_id from public.sales_quotations where id = v_q2)), ('q5', v_q5), ('inv_issued', v_inv2), ('lead2', v_lead2), ('course2', v_course2), ('news', v_news);
  end;
  perform set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true);
end;
$seed$;

grant usage on schema rbac_test to anon, authenticated, service_role;
grant select on rbac_test.ids, rbac_test.persona to anon, authenticated;
