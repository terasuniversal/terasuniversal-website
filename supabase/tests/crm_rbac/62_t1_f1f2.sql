-- F1-a / F2 remediation checks (Owner GO 26 Nov; local Docker fixture only, synthetic data).
-- Runs at stage F after 60_t1.sql (it uses that file's personas and the t1f_* fixtures). Prints CHECK PASS/FAIL lines.
\set ON_ERROR_STOP on

create or replace function rbac_test.t1f_as(p_code text, p_sql text) returns text language plpgsql as $$
-- Runs p_sql as the persona and KEEPS the effect (unlike rbac_test.probe), so the audit rows can be inspected.
declare n bigint;
begin
  perform rbac_test.claims(p_code);
  execute 'set local role authenticated';
  execute p_sql;
  get diagnostics n = row_count;
  reset role;
  return 'ok:' || n;
exception when others then
  reset role;
  return 'err:' || sqlstate || ':' || left(sqlerrm, 120);
end $$;

create or replace function rbac_test.t1f_check(p_label text, p_ok boolean, p_detail text default '') returns void language plpgsql as $$
begin
  raise notice '%', case when p_ok then 'CHECK PASS ' else 'CHECK FAIL ' end || p_label || case when p_detail <> '' then ' (' || p_detail || ')' else '' end;
end $$;

do $f1f2$
declare
  v_res text; v_to uuid := (select uid from rbac_test.persona where code = 'TO'); v_sa uuid := (select uid from rbac_test.persona where code = 'SA');
  v_at9 uuid := (select id from rbac_test.ids where k = 't1f_at9'); v_at7 uuid := (select id from rbac_test.ids where k = 't1f_at7');
  v_log record; n int;
begin
  -- 1. Training Ops Undo writes the generic attendance audit row AND a detailed attendance_undo row (actor, removed mark).
  v_res := rbac_test.t1f_as('TO', format('delete from public.attendance where id = %L', v_at9));
  perform rbac_test.t1f_check('Training Ops Undo succeeds', v_res = 'ok:1', v_res);
  select * into v_log from public.audit_logs where entity_type = 'attendance_undo' and entity_id = v_at9::text order by id desc limit 1;
  perform rbac_test.t1f_check('Undo audit row exists with the actor', v_log.actor_id = v_to and v_log.action = 'delete', coalesce(v_log.actor_id::text, 'none'));
  perform rbac_test.t1f_check('Undo audit row records the removed mark',
    v_log.metadata ->> 'schedule_id' = (select id from rbac_test.ids where k = 't1f_s')::text
    and v_log.metadata ->> 'participant_id' = (select id from rbac_test.ids where k = 't1f_p9')::text
    and v_log.metadata ->> 'session_date' = current_date::text and v_log.metadata ->> 'attendance_status' = 'present'
    and v_log.metadata ->> 'super_admin' = 'false', left(v_log.metadata::text, 120));
  select count(*) into n from public.audit_logs where entity_type = 'attendance' and entity_id = v_at9::text and action = 'delete' and actor_id = v_to;
  perform rbac_test.t1f_check('generic attendance audit row also written', n = 1, n::text);
  perform rbac_test.t1f_check('Undo audit metadata holds no names or identity numbers',
    not (v_log.metadata ?| array['full_name', 'participant_name', 'ic_passport_no', 'identity_no', 'email', 'phone']), '');

  -- 2. A refused Undo (finalised participant) leaves no row removed and no audit row.
  v_res := rbac_test.t1f_as('TO', format('delete from public.attendance where id = %L', v_at7));
  perform rbac_test.t1f_check('Training Ops Undo of a finalised participant refused (42501)', v_res like 'err:42501:%', v_res);
  perform rbac_test.t1f_check('refused Undo keeps the row and writes no audit row',
    exists (select 1 from public.attendance where id = v_at7)
    and not exists (select 1 from public.audit_logs where entity_type in ('attendance_undo', 'attendance') and entity_id = v_at7::text and action = 'delete'), '');

  -- 3. Super Admin Undo of a finalised participant is allowed and audited as Super Admin.
  v_res := rbac_test.t1f_as('SA', format('delete from public.attendance where id = %L', v_at7));
  perform rbac_test.t1f_check('Super Admin Undo of a finalised participant allowed', v_res = 'ok:1', v_res);
  perform rbac_test.t1f_check('Super Admin Undo audited with super_admin = true',
    exists (select 1 from public.audit_logs where entity_type = 'attendance_undo' and entity_id = v_at7::text and actor_id = v_sa
            and metadata ->> 'super_admin' = 'true'), '');

  -- 4. Unauthorised personas get 0 rows (RLS) and leave no audit row; the guard reveals nothing to them.
  v_res := rbac_test.t1f_as('TV', format('delete from public.attendance where id = %L', (select id from rbac_test.ids where k = 't1f_at8')));
  perform rbac_test.t1f_check('Training View-only Undo removes nothing', v_res = 'ok:0', v_res);
  v_res := rbac_test.t1f_as('SS', format('delete from public.attendance where id = %L', (select id from rbac_test.ids where k = 't1f_at8')));
  perform rbac_test.t1f_check('Sales staff Undo removes nothing', v_res = 'ok:0', v_res);
  v_res := rbac_test.t1f_as('FS', format('delete from public.attendance where id = %L', (select id from rbac_test.ids where k = 't1f_at8')));
  perform rbac_test.t1f_check('Finance staff Undo removes nothing', v_res = 'ok:0', v_res);
  perform rbac_test.t1f_check('no audit row for the refused personas',
    not exists (select 1 from public.audit_logs where entity_id = (select id from rbac_test.ids where k = 't1f_at8')::text and action = 'delete'), '');

  -- 5. F2: Training Ops cannot unlock; Super Admin can, and the unlock is audited by the existing skill-result audit trigger.
  v_res := rbac_test.t1f_as('TO', format('update public.participant_skill_results set locked = false, locked_at = null, locked_by = null where id = %L', (select id from rbac_test.ids where k = 't1f_k9')));
  perform rbac_test.t1f_check('Training Ops unlock of a finalised skill result refused (42501)', v_res like 'err:42501:%Only a Super Admin can unlock%', v_res);
  v_res := rbac_test.t1f_as('AT', format('update public.participant_skill_results set locked = false where id = %L', (select id from rbac_test.ids where k = 't1f_k9')));
  perform rbac_test.t1f_check('Admin unlock of a finalised skill result refused (42501)', v_res like 'err:42501:%', v_res);
  perform rbac_test.t1f_check('skill result still locked after the refusals',
    (select locked from public.participant_skill_results where id = (select id from rbac_test.ids where k = 't1f_k9')), '');
  v_res := rbac_test.t1f_as('SA', format('update public.participant_skill_results set locked = false, locked_at = null, locked_by = null where id = %L', (select id from rbac_test.ids where k = 't1f_k9')));
  perform rbac_test.t1f_check('Super Admin unlock allowed', v_res = 'ok:1', v_res);
  perform rbac_test.t1f_check('Super Admin unlock audited',
    exists (select 1 from public.audit_logs where entity_type = 'participant_skill_results' and entity_id = (select id from rbac_test.ids where k = 't1f_k9')::text
            and action = 'update' and actor_id = v_sa), '');

  -- 6. No client-callable function writes attendance or skill results around these guards (only the Admin-gated WAH correction).
  select count(*) into n from pg_proc p
   where p.pronamespace in ('public'::regnamespace, 'app'::regnamespace) and p.prokind = 'f'
     and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))
     and p.prosrc ~* '(delete\s+from|update|insert\s+into)\s+(public\.)?(attendance|participant_skill_results)\M'
     and p.proname <> 'correct_wah_failed_practical_assessment';
  perform rbac_test.t1f_check('no other client-callable function writes attendance or skill results', n = 0, n::text);
  -- 7. C1-b: attendance_undo cannot be forged through log_event, even with the live Staging grant replicated here.
  v_res := rbac_test.t1f_as('TO', $s$select app.log_event('delete'::audit_action, 'attendance_undo', 'zz-forge-app', 'x', '{}'::jsonb)$s$);
  perform rbac_test.t1f_check('C1-b: app.log_event not callable by Training Ops', v_res like 'err:42501:%', v_res);
  execute 'grant execute on function public.log_event(audit_action,text,text,text,jsonb) to authenticated';
  v_res := rbac_test.t1f_as('TO', $s$select public.log_event('delete'::audit_action, 'attendance_undo', 'zz-forge-pub', 'Attendance Undo', '{"super_admin": true}'::jsonb)$s$);
  perform rbac_test.t1f_check('C1-b: forged attendance_undo refused even with the Staging grant', v_res like 'err:42501:%recorded by the database only%', v_res);
  v_res := rbac_test.t1f_as('TO', $s$select public.log_event('export'::audit_action, 'attendance', 'zz-export', 'Exported attendance', '{}'::jsonb)$s$);
  perform rbac_test.t1f_check('C1-b: other log_event entities unchanged (Staging-grant path still records exports)', v_res = 'ok:1', v_res);
  execute 'revoke execute on function public.log_event(audit_action,text,text,text,jsonb) from authenticated';
  perform rbac_test.t1f_check('C1-b: no forged attendance_undo row exists',
    not exists (select 1 from public.audit_logs where entity_type = 'attendance_undo' and entity_id in ('zz-forge-app', 'zz-forge-pub')), '');
  perform rbac_test.t1f_check('C1-b: Undo audit rows carry the session actor and its e-mail (not caller supplied)',
    (select bool_and(l.actor_id is not null and l.actor_email is not distinct from (select p.email from public.profiles p where p.id = l.actor_id))
       from public.audit_logs l where l.entity_type = 'attendance_undo'), '');
  perform rbac_test.t1f_check('C1-b: app.log_event and the T1 helper stay non-client-callable',
    not has_function_privilege('authenticated', 'app.log_event(audit_action,text,text,text,jsonb)', 'execute')
    and not has_function_privilege('authenticated', 'app.t1_participant_finalised(uuid,uuid)', 'execute')
    and not has_function_privilege('anon', 'app.t1_participant_finalised(uuid,uuid)', 'execute'), '');
  perform public.log_event_as_service((select uid from rbac_test.persona where code = 'SA'), null, 'export'::audit_action, 'reports', 'zz-svc', 'r4 check', '{}'::jsonb);
  perform rbac_test.t1f_check('C1-b: service-role audit path (log_event_as_service) still records events',
    exists (select 1 from public.audit_logs where entity_id = 'zz-svc'), '');
  perform rbac_test.t1f_check('new guard function is not client-callable',
    not has_function_privilege('authenticated', 'app.t1_guard_attendance_finalised()', 'execute')
    and not has_function_privilege('anon', 'app.t1_guard_attendance_finalised()', 'execute'), '');
end;
$f1f2$;

-- ---------------------------------------------------------------- K2 (Owner GO D4, 27 Nov): restore guard, G9-1, lock order
do $k2$
declare
  v_res text; v_br uuid; v_tpl uuid; v_wtpl uuid; v_c uuid; v_s uuid; v_p uuid; v_a uuid; v_b uuid;
  v_ws1 uuid; v_ws2 uuid; v_wp uuid; v_w1 uuid; v_w2 uuid; v_lc uuid; v_lc2 uuid; v_lp uuid; v_l1 uuid; v_l2 uuid; v_l3 uuid;
  v_gp uuid; n int;
  wah constant uuid := '963b1f6b-4c15-4833-90da-21aa0af0f544';
begin
  -- fixtures (reference data as the migration owner; every checked action runs as a persona through RLS)
  perform rbac_test.claims('AN');  -- clear the previous persona: fixture rows are written as a server session
  insert into public.certificate_branches (branch_code, branch_name, display_address) values ('K2BR', 'K2 branch', 'synthetic') returning id into v_br;
  insert into public.certificate_templates (name, orientation, paper_size, config, is_active, is_default)
  values ('K2 template', 'landscape', 'A4', '{}'::jsonb, true, false) returning id into v_tpl;
  insert into public.certificate_templates (name, orientation, paper_size, config, is_active, is_default)
  values ('K2 WAH template', 'landscape', 'A4', '{"design_variant": "working_at_height_certificate", "signature_name": "Synthetic", "signature_title": "Synthetic", "signature_url": "https://example.invalid/sig.png"}'::jsonb, true, false)
  returning id into v_wtpl;
  update public.courses set certificate_generation_enabled = true, certificate_template_id = v_wtpl, assessment_required = false,
         competency_required = false, attendance_min_percent = 100 where id = wah;
  insert into public.courses (title, certificate_template_id, certificate_generation_enabled) values ('K2 course', v_tpl, true) returning id into v_c;
  insert into public.course_schedules (course_id, start_date, end_date, capacity, trainer_name, venue, status, branch_id)
  values (v_c, current_date - 1, current_date - 1, 10, 'K2 Trainer', 'K2 Venue', 'completed', v_br) returning id into v_s;
  insert into public.participants (full_name, ic_passport_no, status) values ('K2 HOLDER', 'SYNTH-K2-0001', 'registered') returning id into v_p;
  insert into public.schedule_participants (schedule_id, participant_id, registration_status) values (v_s, v_p, 'registered');
  insert into public.attendance (schedule_id, participant_id, session_date, attendance_status) values (v_s, v_p, current_date - 1, 'present');
  -- two WAH schedules for one person (participant-level WAH rule)
  insert into public.course_schedules (course_id, start_date, end_date, capacity, trainer_name, venue, status, branch_id)
  values (wah, current_date - 9, current_date - 9, 10, 'K2 WAH Trainer', 'K2 Venue', 'completed', v_br) returning id into v_ws1;
  insert into public.course_schedules (course_id, start_date, end_date, capacity, trainer_name, venue, status, branch_id)
  values (wah, current_date - 3, current_date - 3, 10, 'K2 WAH Trainer', 'K2 Venue', 'completed', v_br) returning id into v_ws2;
  insert into public.participants (full_name, ic_passport_no, status) values ('K2 WAH HOLDER', 'SYNTH-K2-W001', 'registered') returning id into v_wp;
  insert into public.schedule_participants (schedule_id, participant_id, registration_status) values (v_ws1, v_wp, 'registered'), (v_ws2, v_wp, 'registered');
  insert into public.attendance (schedule_id, participant_id, session_date, attendance_status)
  values (v_ws1, v_wp, current_date - 9, 'present'), (v_ws2, v_wp, current_date - 3, 'present');
  insert into public.participant_skill_results (schedule_id, participant_id, area, status)
  select s, v_wp, x.area, x.st from unnest(array[v_ws1, v_ws2]) s,
    (values ('theory_session', 'completed'), ('practical_training', 'completed'), ('safety_awareness', 'completed'), ('practical_assessment', 'passed')) x(area, st);
  -- schedule-less (legacy) certificates: one deleted, one active, same participant and course; plus one of another course
  insert into public.courses (title) values ('K2 legacy course') returning id into v_lc;
  insert into public.courses (title) values ('K2 legacy course 2') returning id into v_lc2;
  insert into public.participants (full_name, status) values ('K2 LEGACY HOLDER', 'registered') returning id into v_lp;
  insert into public.certificates (certificate_no, participant_name, course_name, issue_date, participant_id, course_id, status, deleted_at)
  values ('K2-L-1', 'K2 LEGACY HOLDER', 'K2 legacy course', current_date, v_lp, v_lc, 'valid', now()) returning id into v_l1;
  insert into public.certificates (certificate_no, participant_name, course_name, issue_date, participant_id, course_id, status)
  values ('K2-L-2', 'K2 LEGACY HOLDER', 'K2 legacy course', current_date, v_lp, v_lc, 'valid') returning id into v_l2;
  insert into public.certificates (certificate_no, participant_name, course_name, issue_date, participant_id, course_id, status, deleted_at)
  values ('K2-L-3', 'K2 LEGACY HOLDER', 'K2 legacy course 2', current_date, v_lp, v_lc2, 'valid', now()) returning id into v_l3;

  -- K2-a: lock order (structural; the behaviour is raced in conc_t1.sh)
  perform rbac_test.t1f_check('K2-a issuer locks the schedule before reading eligibility',
    (select position('for update' in prosrc) between 1 and position('from public.v_certificate_eligibility' in prosrc)
       from pg_proc where oid = 'app.issue_certificate_with_skill_snapshot(uuid,uuid,text)'::regprocedure), '');
  perform rbac_test.t1f_check('K2-a WAH wrapper locks the schedule before the authorization',
    (select position('for update' in prosrc) between 1 and position('authorize_wah_first_issuance' in prosrc)
       from pg_proc where oid = 'app.issue_wah_certificate_as_super_admin(uuid,uuid,text)'::regprocedure), '');

  -- K2-b: restoring a soft-deleted certificate
  v_res := rbac_test.t1f_as('SA', format('select * from public.issue_certificate_with_skill_snapshot(%L, %L, %L)', v_s, v_p, 'K2-0001'));
  perform rbac_test.t1f_check('K2-b fixture: Super Admin issues certificate A', v_res = 'ok:1', v_res);
  select id into v_a from public.certificates where certificate_number = 'K2-0001';
  v_res := rbac_test.t1f_as('SA', format('select app.set_certificate_deleted(%L, true)', v_a));
  perform rbac_test.t1f_check('K2-b soft delete is unchanged (Super Admin)', v_res = 'ok:1', v_res);
  v_res := rbac_test.t1f_as('SA', format('select * from public.issue_certificate_with_skill_snapshot(%L, %L, %L)', v_s, v_p, 'K2-0002'));
  perform rbac_test.t1f_check('K2-b replacement certificate B issued while A is deleted', v_res = 'ok:1', v_res);
  select id into v_b from public.certificates where certificate_number = 'K2-0002';
  v_res := rbac_test.t1f_as('SA', format('select app.set_certificate_deleted(%L, false)', v_a));
  perform rbac_test.t1f_check('K2-b restore of A refused while B is active (same schedule)', v_res like 'err:P0001:CERTIFICATE_RESTORE_CONFLICT%', v_res);
  v_res := rbac_test.t1f_as('TO', format('select app.set_certificate_deleted(%L, false)', v_a));
  perform rbac_test.t1f_check('K2-b Training Ops cannot restore', v_res like 'err:42501:%', v_res);
  v_res := rbac_test.t1f_as('SA', format('select app.revoke_certificate(%L, %L)', v_b, 'K2 replaced'));
  v_res := rbac_test.t1f_as('SA', format('select app.set_certificate_deleted(%L, false)', v_a));
  perform rbac_test.t1f_check('K2-b restore of A allowed once B is revoked', v_res = 'ok:1', v_res);
  perform rbac_test.t1f_check('K2-b history kept: A valid, B revoked, both rows present',
    (select string_agg(certificate_number || '=' || status || ':' || (deleted_at is null)::text, ',' order by certificate_number)
       from public.certificates where id in (v_a, v_b)) = 'K2-0001=valid:true,K2-0002=revoked:true',
    (select string_agg(certificate_number || '=' || status || ':' || (deleted_at is null)::text, ',' order by certificate_number) from public.certificates where id in (v_a, v_b)));
  v_res := rbac_test.t1f_as('SA', format('select app.set_certificate_deleted(%L, false)', v_l1));
  perform rbac_test.t1f_check('K2-b schedule-less restore refused while an active certificate of the same course exists', v_res like 'err:P0001:CERTIFICATE_RESTORE_CONFLICT%', v_res);
  v_res := rbac_test.t1f_as('SA', format('select app.set_certificate_deleted(%L, false)', v_l3));
  perform rbac_test.t1f_check('K2-b schedule-less restore allowed for another course', v_res = 'ok:1', v_res);
  -- WAH: certificate on schedule 1, deleted; a new one on schedule 2; restoring the first would give two WAH holders
  v_res := rbac_test.t1f_as('SA', format('select * from public.issue_wah_certificate_as_super_admin(%L, %L, %L)', v_ws1, v_wp, 'K2-W-0001'));
  perform rbac_test.t1f_check('K2-b fixture: WAH certificate 1 issued (wrapper with the new lock)', v_res = 'ok:1', v_res);
  select id into v_w1 from public.certificates where certificate_number = 'K2-W-0001';
  v_res := rbac_test.t1f_as('SA', format('select app.set_certificate_deleted(%L, true)', v_w1));
  v_res := rbac_test.t1f_as('SA', format('select * from public.issue_wah_certificate_as_super_admin(%L, %L, %L)', v_ws2, v_wp, 'K2-W-0002'));
  perform rbac_test.t1f_check('K2-b fixture: WAH certificate 2 issued on another schedule', v_res = 'ok:1', v_res);
  v_res := rbac_test.t1f_as('SA', format('select app.set_certificate_deleted(%L, false)', v_w1));
  perform rbac_test.t1f_check('K2-b WAH restore refused while the person holds another active WAH certificate', v_res like 'err:P0001:CERTIFICATE_RESTORE_CONFLICT%', v_res);
  perform rbac_test.t1f_check('K2-b /verify of the active WAH certificate unchanged',
    (select string_agg(coalesce(status::text, ''), ',') from public.verify_and_log('K2-W-0002', 'number', '192.0.2.30', 'k2')) = 'valid', '');

  -- K2-c (G9-1): identity details are Super Admin only
  insert into public.participants (full_name, ic_passport_no, identity_no, identity_last4, phone, status)
  values ('K2 G9 HOLDER', 'SYNTH-K2-G901', null, 'ab12', '0100000000', 'registered') returning id into v_gp;
  v_res := rbac_test.t1f_as('TO', format('update public.participants set full_name = %L where id = %L', 'K2 G9 CHANGED', v_gp));
  perform rbac_test.t1f_check('G9-1 Training Ops cannot change the name', v_res like 'err:42501:Only a Super Admin can change%', v_res);
  v_res := rbac_test.t1f_as('TO', format('update public.participants set ic_passport_no = %L where id = %L', 'SYNTH-K2-G999', v_gp));
  perform rbac_test.t1f_check('G9-1 Training Ops cannot change IC/passport', v_res like 'err:42501:%', v_res);
  v_res := rbac_test.t1f_as('TO', format('update public.participants set identity_no = %L where id = %L', 'SYNTH-K2-G999', v_gp));
  perform rbac_test.t1f_check('G9-1 Training Ops cannot change identity_no', v_res like 'err:42501:%', v_res);
  v_res := rbac_test.t1f_as('TO', format('update public.participants set identity_last4 = %L where id = %L', '9999', v_gp));
  perform rbac_test.t1f_check('G9-1 Training Ops cannot change identity_last4', v_res like 'err:42501:%', v_res);
  v_res := rbac_test.t1f_as('TO', format('update public.participants set date_of_birth = %L where id = %L', '1990-01-01', v_gp));
  perform rbac_test.t1f_check('G9-1 Training Ops cannot change date of birth', v_res like 'err:42501:%', v_res);
  v_res := rbac_test.t1f_as('TO', format('update public.participants set nationality = %L where id = %L', 'Other', v_gp));
  perform rbac_test.t1f_check('G9-1 Training Ops cannot change nationality', v_res like 'err:42501:%', v_res);
  v_res := rbac_test.t1f_as('TO', format('update public.participants set phone = %L, company = %L where id = %L', '0111111111', 'K2 Co', v_gp));
  perform rbac_test.t1f_check('G9-1 Training Ops can still change contact details (last4 normalisation is not a change)', v_res = 'ok:1', v_res);
  -- a legacy row whose identity_last4 is stale (written before participants_sync_last4 existed): when a client resends
  -- the unchanged identity_no, the sync trigger recomputes identity_last4, which must not count as an identity change
  execute 'alter table public.participants disable trigger participants_sync_last4';
  insert into public.participants (full_name, ic_passport_no, identity_no, identity_last4, status)
  values ('K2 G9 LEGACY', 'SYNTH-K2-G977', 'SYNTH-K2-G977', null, 'registered') returning id into v_lc2;
  execute 'alter table public.participants enable trigger participants_sync_last4';
  v_res := rbac_test.t1f_as('TO', format('update public.participants set phone = %L, identity_no = identity_no where id = %L', '0122222222', v_lc2));
  perform rbac_test.t1f_check('G9-1 resending an unchanged identity_no on a legacy row is not an identity change',
    v_res = 'ok:1' and (select identity_last4 from public.participants where id = v_lc2) = 'G977', v_res);
  v_res := rbac_test.t1f_as('TO', $s$insert into public.participants (full_name, ic_passport_no, status) values ('K2 G9 NEW', 'SYNTH-K2-G902', 'registered')$s$);
  perform rbac_test.t1f_check('G9-1 Training Ops can still register a new participant', v_res = 'ok:1', v_res);
  v_res := rbac_test.t1f_as('AT', format('update public.participants set full_name = %L where id = %L', 'K2 G9 BY ADMIN', v_gp));
  perform rbac_test.t1f_check('G9-1 Admin cannot change the name', v_res like 'err:42501:%', v_res);
  select count(*) into n from public.audit_logs where entity_id = v_gp::text;
  v_res := rbac_test.t1f_as('SA', format('update public.participants set full_name = %L, ic_passport_no = %L where id = %L', 'K2 G9 CORRECTED', 'SYNTH-K2-G903', v_gp));
  perform rbac_test.t1f_check('G9-1 Super Admin can correct name and IC', v_res = 'ok:1', v_res);
  perform rbac_test.t1f_check('G9-1 Super Admin correction is audited',
    (select count(*) from public.audit_logs where entity_id = v_gp::text) > n, '');
  v_res := rbac_test.t1f_as('SA', format('update public.participants set ic_passport_no = %L where id = %L', 'SYNTH-K2-0001', v_gp));
  perform rbac_test.t1f_check('G9-1 duplicate identity protection unchanged (Super Admin cannot take another IC)', v_res like 'err:23505:%', v_res);
  perform rbac_test.claims('AN');
  update public.participants set full_name = 'K2 G9 SERVER' where id = v_gp;
  get diagnostics n = row_count;
  perform rbac_test.t1f_check('G9-1 server session (no auth.uid) is not restricted', n = 1, n::text);
  perform rbac_test.t1f_check('G9-1 participant id stable after corrections',
    exists (select 1 from public.participants where id = v_gp and full_name = 'K2 G9 SERVER'), '');
  perform rbac_test.t1f_check('G9-1 guard function is not client-callable',
    not has_function_privilege('authenticated', 'app.t1_guard_participant_identity()', 'execute')
    and not has_function_privilege('anon', 'app.t1_guard_participant_identity()', 'execute'), '');
end;
$k2$;
