-- C4 certificate regression for Training T1 (local Docker only, synthetic data). Runs inside the stage transaction
-- after 60_t1.sql at stage E (released) and stage F (released + T1). Every line starting "C4|" must be IDENTICAL at E
-- and F (the runner diffs them): eligibility, issuance, /verify, WAH failed-result protection and the audited WAH
-- correction must behave the same with T1 applied. Lines starting "C4F|" are stage-specific and checked by value.
\set ON_ERROR_STOP on

create or replace function rbac_test.c4_step(p_sql text) returns text language plpgsql as $$
declare v text;
begin
  begin
    execute p_sql into v;
    return 'ok:' || coalesce(v, '');
  exception when others then
    return 'err:' || sqlstate || ':' || left(sqlerrm, 90);
  end;
end $$;
grant execute on function rbac_test.c4_step(text) to authenticated, anon;

do $c4seed$
declare v_tpl uuid; v_course uuid; v_s uuid; v_a uuid; v_p uuid; v_ws uuid; v_wp1 uuid; v_wp2 uuid; v_wp3 uuid; v_br uuid;
begin
  insert into public.certificate_branches (branch_code, branch_name, display_address) values ('RBACC4', 'RBAC C4 branch', 'synthetic') returning id into v_br;
  insert into public.certificate_templates (name, orientation, paper_size, config, is_active, is_default)
  values ('RBAC C4 template', 'landscape', 'A4', '{}'::jsonb, true, false) returning id into v_tpl;
  insert into public.courses (title, certificate_template_id, certificate_generation_enabled)
  values ('RBAC C4 course', v_tpl, true) returning id into v_course;
  insert into public.course_schedules (course_id, start_date, end_date, capacity, trainer_name, status)
  values (v_course, current_date - 1, current_date - 1, 10, 'RBAC C4 Trainer', 'completed') returning id into v_s;
  update public.course_schedules set branch_id = v_br where id = v_s;
  insert into public.assessors (full_name, ic_passport_no, email, is_active) values ('RBAC C4 Assessor', 'SYNTH-C4-0001', 'c4a@rbac.invalid', true) returning id into v_a;
  insert into public.schedule_assessors (schedule_id, assessor_id, is_primary) values (v_s, v_a, true);
  insert into public.participants (full_name, status) values ('RBAC C4 Holder', 'registered') returning id into v_p;
  insert into public.schedule_participants (schedule_id, participant_id, registration_status) values (v_s, v_p, 'registered');
  insert into public.attendance (schedule_id, participant_id, session_date, attendance_status) values (v_s, v_p, current_date - 1, 'present');
  -- WAH schedule with recorded Failed practical assessments (the protected state).
  insert into public.course_schedules (course_id, start_date, end_date, capacity, trainer_name, status)
  values ('963b1f6b-4c15-4833-90da-21aa0af0f544', current_date - 2, current_date - 2, 10, 'RBAC C4 WAH Trainer', 'completed') returning id into v_ws;
  insert into public.schedule_assessors (schedule_id, assessor_id, is_primary) values (v_ws, v_a, true);
  insert into public.participants (full_name, status) values ('RBAC C4 WAH 1', 'registered') returning id into v_wp1;
  insert into public.participants (full_name, status) values ('RBAC C4 WAH 2', 'registered') returning id into v_wp2;
  insert into public.participants (full_name, status) values ('RBAC C4 WAH 3', 'registered') returning id into v_wp3;
  insert into public.schedule_participants (schedule_id, participant_id, registration_status) values (v_ws, v_wp1, 'registered'), (v_ws, v_wp2, 'registered'), (v_ws, v_wp3, 'registered');
  insert into public.participant_skill_results (schedule_id, participant_id, area, status)
  values (v_ws, v_wp1, 'practical_assessment', 'failed'), (v_ws, v_wp2, 'practical_assessment', 'failed'), (v_ws, v_wp3, 'practical_assessment', 'failed');
  insert into rbac_test.ids values ('c4_s', v_s), ('c4_p', v_p), ('c4_a', v_a), ('c4_ws', v_ws), ('c4_wp1', v_wp1), ('c4_wp2', v_wp2), ('c4_wp3', v_wp3);
  -- AT gets Assessment at Admin level for this check only (the Admin + assessment-admin branch of the WAH correction).
  update public.staff_module_access set access_level = 'admin'
   where user_id = (select uid from rbac_test.persona where code = 'AT') and module_key = 'assessment';
end;
$c4seed$;

create temp table c4_out (n serial, line text);
grant all on c4_out to authenticated, anon; grant usage on sequence c4_out_n_seq to authenticated, anon;

-- 1. Super Admin records the result the released way (no evidence fields: also the "old app on new DB" payload).
select rbac_test.claims('SA'); set local role authenticated;
insert into c4_out (line) select 'C4|SA assessment insert|' || rbac_test.c4_step($q$
  with i as (insert into public.assessments (schedule_id, participant_id, result, competency_status, theory_score, practical_score)
             values ((select id from rbac_test.ids where k = 'c4_s'), (select id from rbac_test.ids where k = 'c4_p'), 'pass', 'competent', 80, 85) returning result) select result from i$q$);
insert into c4_out (line) select 'C4|eligibility|' || rbac_test.c4_step($q$
  select eligible::text || ':' || coalesce(ineligibility_reason, '') from public.v_certificate_eligibility
   where schedule_id = (select id from rbac_test.ids where k = 'c4_s') and participant_id = (select id from rbac_test.ids where k = 'c4_p')$q$);
reset role;

-- 2. Training Ops cannot issue; Super Admin issues; the public /verify contract returns the same answer.
select rbac_test.claims('TO'); set local role authenticated;
insert into c4_out (line) select 'C4|TO issue|' || rbac_test.c4_step($q$
  select count(*)::text from public.issue_certificate_with_skill_snapshot((select id from rbac_test.ids where k = 'c4_s'), (select id from rbac_test.ids where k = 'c4_p'), 'C4T1-0001')$q$);
insert into c4_out (line) select 'C4|TO WAH issue|' || rbac_test.c4_step($q$
  select count(*)::text from public.issue_wah_certificate_as_super_admin((select id from rbac_test.ids where k = 'c4_ws'), (select id from rbac_test.ids where k = 'c4_wp1'), 'C4T1-W001')$q$);
reset role;
select rbac_test.claims('SA'); set local role authenticated;
insert into c4_out (line) select 'C4|SA issue|' || rbac_test.c4_step($q$
  select count(*)::text from public.issue_certificate_with_skill_snapshot((select id from rbac_test.ids where k = 'c4_s'), (select id from rbac_test.ids where k = 'c4_p'), 'C4T1-0001')$q$);
reset role;
select rbac_test.claims('AN'); set local role anon;
insert into c4_out (line) select 'C4|verify by number|' || rbac_test.c4_step($q$
  select string_agg(coalesce(status::text, '') , ',') from public.verify_and_log('C4T1-0001', 'number', '192.0.2.10', 'rbac-c4')$q$);
insert into c4_out (line) select 'C4|verify unknown|' || rbac_test.c4_step($q$
  select count(*)::text from public.verify_and_log('C4T1-NOPE', 'number', '192.0.2.10', 'rbac-c4')$q$);
reset role;

-- 3. WAH: a recorded Failed practical stays protected; only the audited correction changes it.
select rbac_test.claims('SA'); set local role authenticated;
insert into c4_out (line) select 'C4|SA direct overwrite of WAH Failed|' || rbac_test.c4_step($q$
  with u as (update public.participant_skill_results set status = 'passed'
             where schedule_id = (select id from rbac_test.ids where k = 'c4_ws') and participant_id = (select id from rbac_test.ids where k = 'c4_wp1') and area = 'practical_assessment' returning 1)
  select count(*)::text from u$q$);
insert into c4_out (line) select 'C4|SA WAH correction|' || rbac_test.c4_step($q$
  select (public.correct_wah_failed_practical_assessment((select id from rbac_test.ids where k = 'c4_ws'), (select id from rbac_test.ids where k = 'c4_wp1'), 'passed', 'RBAC C4 retest evidence on file', 'REF-C4-01') is not null)::text$q$);
reset role;
select rbac_test.claims('AT'); set local role authenticated;
insert into c4_out (line) select 'C4|Admin+assessment-admin WAH correction (no T1 evidence needed)|' || rbac_test.c4_step($q$
  select (public.correct_wah_failed_practical_assessment((select id from rbac_test.ids where k = 'c4_ws'), (select id from rbac_test.ids where k = 'c4_wp2'), 'not_recorded', 'RBAC C4 result recorded in error', 'REF-C4-02') is not null)::text$q$);
reset role;
select rbac_test.claims('TO'); set local role authenticated;
insert into c4_out (line) select 'C4|TO WAH correction|' || rbac_test.c4_step($q$
  select (public.correct_wah_failed_practical_assessment((select id from rbac_test.ids where k = 'c4_ws'), (select id from rbac_test.ids where k = 'c4_wp3'), 'passed', 'RBAC C4 attempt by Training Ops', 'REF-C4-03') is not null)::text$q$);
reset role;
insert into c4_out (line) select 'C4|WAH statuses after|' || string_agg(r.status, ',' order by p.full_name)
  from public.participant_skill_results r join public.participants p on p.id = r.participant_id
 where r.schedule_id = (select id from rbac_test.ids where k = 'c4_ws') and r.area = 'practical_assessment' and r.deleted_at is null;
insert into c4_out (line) select 'C4|WAH correction audit rows|' || count(*)
  from public.audit_logs where summary = 'WAH Failed Practical Assessment corrected' and metadata->>'schedule_id' = (select id::text from rbac_test.ids where k = 'c4_ws');
insert into c4_out (line) select 'C4|certificate issued fields|' || coalesce((select status || ':' || coalesce(trainer_name, '') || ':' || (verification_token is not null)::text
  from public.certificates where certificate_number = 'C4T1-0001'), 'none');

-- 4. TO direct overwrite at stage F (T1 gives TO assessment Edit; the WAH guard must still hold).
select rbac_test.claims('TO'); set local role authenticated;
insert into c4_out (line) select 'C4F|TO direct overwrite of WAH Failed (with evidence)|' || rbac_test.c4_step($q$
  with u as (update public.participant_skill_results set status = 'passed', evidence_assessor_id = (select id from rbac_test.ids where k = 'c4_a'), evidence_reference = 'REF-C4-04'
             where schedule_id = (select id from rbac_test.ids where k = 'c4_ws') and participant_id = (select id from rbac_test.ids where k = 'c4_wp3') and area = 'practical_assessment' returning 1)
  select count(*)::text from u$q$);
reset role;

select line from c4_out order by n;
