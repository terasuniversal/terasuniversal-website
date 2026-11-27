-- Training T1 persona matrix (OWNER-TRAINING-T1-20261125; local Docker fixture only, synthetic data, no real IC numbers).
-- Runs inside the stage transaction after 50_m11.sql. Usage: select * from rbac_test.t1('<stage>');
--   stage E = after M-11, before T1 (expectation "pre"); stage F = E + T1-a + T1-b (expectation "post").
-- Expectation syntax (default D for every persona not named):
--   A=<codes>  allowed (>=1 row / success)     V=<codes>  check violation (23514: evidence / trainer / enrolment rule)
--   X=<codes>  other error (e.g. column missing on the old schema; "*" = everyone)
--   ONLY=<codes> only these personas are probed (others skipped);   SKIP = case not run at this stage
-- Codes D = denied (42501, RLS, 0 rows or false).
\set ON_ERROR_STOP on

insert into rbac_test.persona values
 ('TO', 'aaaaaaaa-0000-4000-8000-000000000030', 'editor', true, true,
  '{"dashboard":"view","reports":"view","courses":"view","schedules":"edit","participants":"edit","trainers":"edit","assessors":"edit","attendance":"edit","assessment":"edit","certificates":"view","downloads":"edit","feedback":"edit","feedback_responses":"view","feedback_issues":"edit","feedback_actions":"edit"}',
  'Training Ops Staff preset (T1)'),
 ('TN', 'aaaaaaaa-0000-4000-8000-000000000031', 'editor', true, true, '{"reports":"view"}', 'Custom editor without Training modules'),
 ('TI', 'aaaaaaaa-0000-4000-8000-000000000032', 'editor', false, true,
  '{"schedules":"edit","participants":"edit","trainers":"edit","assessors":"edit","attendance":"edit","assessment":"edit","certificates":"view"}',
  'INACTIVE Training Ops Staff'),
 ('TV', 'aaaaaaaa-0000-4000-8000-000000000033', 'editor', true, true,
  '{"schedules":"view","participants":"view","trainers":"view","assessors":"view","attendance":"view","assessment":"view"}', 'Training View-only'),
 ('AT', 'aaaaaaaa-0000-4000-8000-000000000034', 'admin', true, true,
  '{"schedules":"edit","participants":"edit","trainers":"edit","assessors":"edit","attendance":"edit","assessment":"edit"}', 'Existing departmental Admin, Training (edit, no admin level)');
insert into auth.users (id, email, aud, role, raw_user_meta_data)
select uid, lower(code) || '@rbac.invalid', 'authenticated', 'authenticated', jsonb_build_object('full_name', 'RBAC ' || code)
from rbac_test.persona where code in ('TO', 'TN', 'TI', 'TV', 'AT');
alter table public.profiles disable trigger user;
update public.profiles p set role = x.role, is_active = x.active, access_control_enabled = x.acl
from rbac_test.persona x where x.uid = p.id and x.code in ('TO', 'TN', 'TI', 'TV', 'AT');
alter table public.profiles enable trigger user;
insert into public.staff_module_access (user_id, module_key, access_level)
select x.uid, m.key, m.value #>> '{}' from rbac_test.persona x, jsonb_each(x.modules) m where x.code in ('TO', 'TN', 'TI', 'TV', 'AT');

-- Synthetic Training data, written as the migration owner (auth.uid() is null: no T1 actor rules apply to the seed).
do $t1seed$
declare v_s uuid; v_ta uuid; v_ti uuid; v_a1 uuid; v_a2 uuid; v_a3 uuid; v_a4 uuid; v_g uuid;
        v_p1 uuid; v_p2 uuid; v_p4 uuid; v_p5 uuid; v_l2 uuid; v_l4 uuid; v_k2 uuid;
begin
  insert into public.course_schedules (course_id, start_date, end_date, capacity, venue)
  values ((select id from rbac_test.ids where k = 'course'), current_date, current_date + 1, 30, 'RBAC T1 venue') returning id into v_s;
  insert into public.trainers (full_name, status) values ('RBAC T1 Trainer', 'active') returning id into v_ta;
  insert into public.trainers (full_name, status) values ('RBAC T1 Trainer Inactive', 'inactive') returning id into v_ti;
  insert into public.assessors (full_name, ic_passport_no, email, is_active) values ('RBAC T1 Assessor 1', 'SYNTH-T1-0001', 't1a1@rbac.invalid', true) returning id into v_a1;
  insert into public.assessors (full_name, ic_passport_no, email, is_active) values ('RBAC T1 Assessor 2', 'SYNTH-T1-0002', 't1a2@rbac.invalid', true) returning id into v_a2;
  insert into public.assessors (full_name, ic_passport_no, email, is_active) values ('RBAC T1 Assessor 3', 'SYNTH-T1-0003', 't1a3@rbac.invalid', false) returning id into v_a3;
  insert into public.assessors (full_name, ic_passport_no, email, is_active) values ('RBAC T1 Assessor 4', 'SYNTH-T1-0004', 't1a4@rbac.invalid', true) returning id into v_a4;
  insert into public.schedule_assessors (schedule_id, assessor_id, is_primary) values (v_s, v_a1, true), (v_s, v_a3, false);
  insert into public.schedule_groups (schedule_id, name, assessor_id) values (v_s, 'RBAC T1 Group', v_a4) returning id into v_g;
  insert into public.participants (full_name, status) values ('RBAC T1 P1', 'registered') returning id into v_p1;
  insert into public.participants (full_name, status) values ('RBAC T1 P2', 'registered') returning id into v_p2;
  insert into public.participants (full_name, status) values ('RBAC T1 P4', 'registered') returning id into v_p4;
  insert into public.participants (full_name, status) values ('RBAC T1 P5', 'registered') returning id into v_p5;
  insert into public.schedule_participants (schedule_id, participant_id, schedule_group_id, registration_status)
  values (v_s, v_p1, v_g, 'registered'), (v_s, v_p2, null, 'registered'), (v_s, v_p4, null, 'registered');
  -- legacy result (no evidence, unlocked) and a finalised (locked) one
  insert into public.assessments (schedule_id, participant_id, result, remarks) values (v_s, v_p2, 'pending', 'legacy') returning id into v_l2;
  insert into public.assessments (schedule_id, participant_id, result, remarks, locked, locked_at, locked_by)
  values (v_s, v_p4, 'pass', 'final', true, now(), (select uid from rbac_test.persona where code = 'SA')) returning id into v_l4;
  insert into public.participant_skill_results (schedule_id, participant_id, area, status) values (v_s, v_p2, 'theory_session', 'completed') returning id into v_k2;
  insert into public.attendance (schedule_id, participant_id, session_date, attendance_status) values (v_s, v_p1, current_date, 'present');
  insert into rbac_test.ids values ('t1_s', v_s), ('t1_ta', v_ta), ('t1_ti', v_ti), ('t1_a1', v_a1), ('t1_a2', v_a2), ('t1_a3', v_a3), ('t1_a4', v_a4),
    ('t1_g', v_g), ('t1_p1', v_p1), ('t1_p2', v_p2), ('t1_p4', v_p4), ('t1_p5', v_p5), ('t1_l2', v_l2), ('t1_l4', v_l4), ('t1_k2', v_k2);
end;
$t1seed$;

-- F1-a / F2 remediation fixtures (Owner GO 26 Nov): a second synthetic schedule so the original cases keep their data.
--   p7 = assessment LOCKED (finalised), p8 = issued (valid) certificate, p9 = unlocked assessment + a LOCKED skill result.
do $t1seed_f$
declare v_s2 uuid; v_p7 uuid; v_p8 uuid; v_p9 uuid; v_k9 uuid; v_c8 uuid; v_at7 uuid; v_at8 uuid; v_at9 uuid;
begin
  insert into public.course_schedules (course_id, start_date, end_date, capacity, venue)
  values ((select id from rbac_test.ids where k = 'course'), current_date, current_date + 1, 30, 'RBAC T1 F venue') returning id into v_s2;
  insert into public.schedule_assessors (schedule_id, assessor_id, is_primary) values (v_s2, (select id from rbac_test.ids where k = 't1_a1'), true);
  insert into public.participants (full_name, status) values ('RBAC T1 P7', 'registered') returning id into v_p7;
  insert into public.participants (full_name, status) values ('RBAC T1 P8', 'registered') returning id into v_p8;
  insert into public.participants (full_name, status) values ('RBAC T1 P9', 'registered') returning id into v_p9;
  insert into public.schedule_participants (schedule_id, participant_id, registration_status)
  values (v_s2, v_p7, 'registered'), (v_s2, v_p8, 'registered'), (v_s2, v_p9, 'registered');
  insert into public.assessments (schedule_id, participant_id, result, remarks, locked, locked_at, locked_by)
  values (v_s2, v_p7, 'pass', 'final', true, now(), (select uid from rbac_test.persona where code = 'SA'));
  insert into public.assessments (schedule_id, participant_id, result, remarks) values (v_s2, v_p9, 'pending', 'open');
  insert into public.participant_skill_results (schedule_id, participant_id, area, status, locked, locked_at, locked_by)
  values (v_s2, v_p9, 'theory_session', 'completed', true, now(), (select uid from rbac_test.persona where code = 'SA')) returning id into v_k9;
  insert into public.certificates (certificate_no, certificate_number, participant_name, holder_name, identity_no, identity_last4, course_name,
                                   issue_date, status, participant_id, course_id, schedule_id, verification_enabled)
  values ('T1F-0001', 'T1F-0001', 'RBAC T1 P8', 'RBAC T1 P8', 'SYNTH-T1F-8', '0008', 'RBAC Course',
          current_date, 'valid', v_p8, (select id from rbac_test.ids where k = 'course'), v_s2, true) returning id into v_c8;
  insert into public.attendance (schedule_id, participant_id, session_date, attendance_status) values (v_s2, v_p7, current_date, 'present') returning id into v_at7;
  insert into public.attendance (schedule_id, participant_id, session_date, attendance_status) values (v_s2, v_p8, current_date, 'present') returning id into v_at8;
  insert into public.attendance (schedule_id, participant_id, session_date, attendance_status) values (v_s2, v_p9, current_date, 'present') returning id into v_at9;
  insert into rbac_test.ids values ('t1f_s', v_s2), ('t1f_p7', v_p7), ('t1f_p8', v_p8), ('t1f_p9', v_p9), ('t1f_k9', v_k9), ('t1f_c8', v_c8),
    ('t1f_at7', v_at7), ('t1f_at8', v_at8), ('t1f_at9', v_at9);
end;
$t1seed_f$;

-- r4 fixtures (Owner GO 27 Nov): p10 = issued certificate WITH an unlocked assessment, an unlocked and an archived skill result.
do $t1seed_r4$
declare v_s2 uuid := (select id from rbac_test.ids where k = 't1f_s'); v_p10 uuid; v_a10 uuid; v_k10 uuid; v_k10x uuid;
begin
  insert into public.participants (full_name, status) values ('RBAC T1 P10', 'registered') returning id into v_p10;
  insert into public.schedule_participants (schedule_id, participant_id, registration_status) values (v_s2, v_p10, 'registered');
  insert into public.assessments (schedule_id, participant_id, result, remarks) values (v_s2, v_p10, 'pass', 'certified, unlocked') returning id into v_a10;
  insert into public.participant_skill_results (schedule_id, participant_id, area, status) values (v_s2, v_p10, 'theory_session', 'completed') returning id into v_k10;
  insert into public.participant_skill_results (schedule_id, participant_id, area, status, deleted_at) values (v_s2, v_p10, 'practical_training', 'completed', now()) returning id into v_k10x;
  insert into public.certificates (certificate_no, certificate_number, participant_name, holder_name, identity_no, identity_last4, course_name,
                                   issue_date, status, participant_id, course_id, schedule_id, verification_enabled)
  values ('T1F-0010', 'T1F-0010', 'RBAC T1 P10', 'RBAC T1 P10', 'SYNTH-T1F-10', '0010', 'RBAC Course',
          current_date, 'valid', v_p10, (select id from rbac_test.ids where k = 'course'), v_s2, true);
  insert into rbac_test.ids values ('t1f_p10', v_p10), ('t1f_a10', v_a10), ('t1f_k10', v_k10), ('t1f_k10x', v_k10x);
end;
$t1seed_r4$;

create table rbac_test.t1_cases (id text primary key, descr text, sql text, pre text, post text);
-- I(k) = (select id from rbac_test.ids where k = 'k'); written out so the case text is the exact SQL that runs.
insert into rbac_test.t1_cases values
 -- ---------------------------------------------------------------- S-1 / read paths
 ('R01', 'SELECT assessors identity number (S-1)',
  $s$select count(ic_passport_no)::text from public.assessors where id = (select id from rbac_test.ids where k = 't1_a1')$s$,
  'A=SA,DA,SS,FS,MG,RD,CE,VO,NG,TR,LS,LF,LM,TO,TN,TV,AT', 'A=SA,TO,TV,AT'),
 ('R02', 'SELECT schedule_assessors assignment',
  $s$select count(*)::text from public.schedule_assessors where schedule_id = (select id from rbac_test.ids where k = 't1_s')$s$,
  'A=SA,DA,SS,FS,MG,RD,CE,VO,NG,TR,LS,LF,LM,TO,TN,TV,AT', 'A=SA,MG,RD,TR,LM,TO,TV,AT'),
 ('R03', 'SELECT schedule_groups (group assessor)',
  $s$select count(*)::text from public.schedule_groups where schedule_id = (select id from rbac_test.ids where k = 't1_s')$s$,
  'A=SA,DA,SS,FS,MG,RD,CE,VO,NG,TR,LS,LF,LM,TO,TN,TV,AT', 'A=SA,MG,RD,TR,LM,TO,TV,AT'),
 ('R04', 'SELECT trainers (unchanged: can_view_trainers)',
  $s$select count(*)::text from public.trainers where id = (select id from rbac_test.ids where k = 't1_ta')$s$,
  'A=SA,RD,TO,TV,AT', 'A=SA,RD,TO,TV,AT'),
 ('R05', 'SELECT assessments (unchanged role floor, documented limitation)',
  $s$select count(*)::text from public.assessments where schedule_id = (select id from rbac_test.ids where k = 't1_s')$s$,
  'A=SA,DA,SS,FS,MG,RD,CE,VO,NG,TR,LS,LF,LM,TO,TN,TV,AT', 'A=SA,DA,SS,FS,MG,RD,CE,VO,NG,TR,LS,LF,LM,TO,TN,TV,AT'),
 -- ---------------------------------------------------------------- schedules, enrolment, participants, trainers, assessors
 ('W01', 'INSERT course_schedules',
  $s$insert into public.course_schedules (course_id, start_date, end_date, capacity) values ((select id from rbac_test.ids where k = 'course'), current_date + 7, current_date + 8, 10)$s$,
  'A=SA,AT', 'A=SA,TO,AT'),
 ('W02', 'UPDATE course_schedules (notes)',
  $s$update public.course_schedules set notes = 'rbac t1' where id = (select id from rbac_test.ids where k = 't1_s')$s$,
  'A=SA,AT', 'A=SA,TO,AT'),
 ('W03', 'archive course_schedules (deleted_at) - Admin floor',
  $s$update public.course_schedules set deleted_at = now() where id = (select id from rbac_test.ids where k = 't1_s')$s$,
  'A=SA,AT', 'A=SA,AT'),
 ('W04', 'assign an ACTIVE trainer (trainer_id)',
  $s$update public.course_schedules set trainer_id = (select id from rbac_test.ids where k = 't1_ta') where id = (select id from rbac_test.ids where k = 't1_s')$s$,
  'SKIP', 'A=SA,TO,AT'),
 ('W05', 'assign an INACTIVE trainer is rejected',
  $s$update public.course_schedules set trainer_id = (select id from rbac_test.ids where k = 't1_ti') where id = (select id from rbac_test.ids where k = 't1_s')$s$,
  'SKIP', 'V=SA,TO,AT'),
 ('W06', 'INSERT schedule_participants (enrol)',
  $s$insert into public.schedule_participants (schedule_id, participant_id) values ((select id from rbac_test.ids where k = 't1_s'), (select id from rbac_test.ids where k = 't1_p5'))$s$,
  'A=SA,AT', 'A=SA,TO,AT'),
 ('W07', 'cancel an enrolment (registration_status)',
  $s$update public.schedule_participants set registration_status = 'cancelled' where schedule_id = (select id from rbac_test.ids where k = 't1_s') and participant_id = (select id from rbac_test.ids where k = 't1_p2')$s$,
  'A=SA,AT', 'A=SA,TO,AT'),
 ('W08', 'archive an enrolment (deleted_at) - Admin floor',
  $s$update public.schedule_participants set deleted_at = now() where schedule_id = (select id from rbac_test.ids where k = 't1_s') and participant_id = (select id from rbac_test.ids where k = 't1_p2')$s$,
  'A=SA,AT', 'A=SA,AT'),
 ('W09', 'INSERT participants',
  $s$insert into public.participants (full_name, status) values ('RBAC T1 new', 'registered')$s$,
  'A=SA,AT', 'A=SA,TO,AT'),
 ('W10', 'archive participants (deleted_at) - Admin floor',
  $s$update public.participants set deleted_at = now() where id = (select id from rbac_test.ids where k = 't1_p5')$s$,
  'A=SA,AT', 'A=SA,AT'),
 ('W11', 'INSERT trainers',
  $s$insert into public.trainers (full_name, status) values ('RBAC T1 new trainer', 'active')$s$,
  'A=SA,AT', 'A=SA,TO,AT'),
 ('W12', 'archive trainers (deleted_at) - Admin floor',
  $s$update public.trainers set deleted_at = now() where id = (select id from rbac_test.ids where k = 't1_ta')$s$,
  'A=SA,AT', 'A=SA,AT'),
 ('W13', 'INSERT assessors',
  $s$insert into public.assessors (full_name, ic_passport_no, email, is_active) values ('RBAC T1 new assessor', 'SYNTH-T1-0099', 't1new@rbac.invalid', true)$s$,
  'A=SA', 'A=SA,TO,AT'),
 ('W14', 'deactivate an assessor',
  $s$update public.assessors set is_active = false where id = (select id from rbac_test.ids where k = 't1_a2')$s$,
  'A=SA', 'A=SA,TO,AT'),
 ('W15', 'INSERT schedule_assessors (assign)',
  $s$insert into public.schedule_assessors (schedule_id, assessor_id, is_primary) values ((select id from rbac_test.ids where k = 't1_s'), (select id from rbac_test.ids where k = 't1_a2'), false)$s$,
  'A=SA', 'A=SA,TO,AT'),
 ('W16', 'INSERT schedule_groups',
  $s$insert into public.schedule_groups (schedule_id, name) values ((select id from rbac_test.ids where k = 't1_s'), 'RBAC T1 G2')$s$,
  'A=SA', 'A=SA,TO,AT'),
 ('W17', 'INSERT attendance',
  $s$insert into public.attendance (schedule_id, participant_id, session_date, attendance_status) values ((select id from rbac_test.ids where k = 't1_s'), (select id from rbac_test.ids where k = 't1_p2'), current_date, 'present')$s$,
  'A=SA,TR,AT', 'A=SA,TR,TO,AT'),
 ('W18', 'DELETE attendance (reset a session)',
  $s$delete from public.attendance where schedule_id = (select id from rbac_test.ids where k = 't1_s') and participant_id = (select id from rbac_test.ids where k = 't1_p1')$s$,
  'A=SA,TR,AT', 'A=SA,TR,TO,AT'),
 -- ---------------------------------------------------------------- assessment accountability
 ('W20', 'INSERT assessment with a valid schedule Assessor + evidence (new app payload; old DB lacks the columns)',
  $s$insert into public.assessments (schedule_id, participant_id, result, evidence_assessor_id, evidence_reference) values ((select id from rbac_test.ids where k = 't1_s'), (select id from rbac_test.ids where k = 't1_p1'), 'pass', (select id from rbac_test.ids where k = 't1_a1'), 'SHEET-T1-001')$s$,
  'X=*', 'A=SA,TR,TO,AT'),
 ('W21', 'INSERT assessment WITHOUT evidence (old app payload)',
  $s$insert into public.assessments (schedule_id, participant_id, result) values ((select id from rbac_test.ids where k = 't1_s'), (select id from rbac_test.ids where k = 't1_p1'), 'pass')$s$,
  'A=SA,TR,AT', 'A=SA V=TR,TO,AT'),
 ('W22', 'evidence: active Assessor NOT assigned to the schedule/group',
  $s$insert into public.assessments (schedule_id, participant_id, result, evidence_assessor_id, evidence_reference) values ((select id from rbac_test.ids where k = 't1_s'), (select id from rbac_test.ids where k = 't1_p1'), 'pass', (select id from rbac_test.ids where k = 't1_a2'), 'SHEET-T1-001')$s$,
  'SKIP', 'V=SA,TR,TO,AT'),
 ('W23', 'evidence: assigned but INACTIVE Assessor',
  $s$insert into public.assessments (schedule_id, participant_id, result, evidence_assessor_id, evidence_reference) values ((select id from rbac_test.ids where k = 't1_s'), (select id from rbac_test.ids where k = 't1_p1'), 'pass', (select id from rbac_test.ids where k = 't1_a3'), 'SHEET-T1-001')$s$,
  'SKIP', 'V=SA,TR,TO,AT'),
 ('W24', 'evidence: the participant''s GROUP Assessor',
  $s$insert into public.assessments (schedule_id, participant_id, result, evidence_assessor_id, evidence_reference) values ((select id from rbac_test.ids where k = 't1_s'), (select id from rbac_test.ids where k = 't1_p1'), 'pass', (select id from rbac_test.ids where k = 't1_a4'), 'SHEET-T1-001')$s$,
  'SKIP', 'A=SA,TR,TO,AT'),
 ('W25', 'evidence: another group''s Assessor for an ungrouped participant',
  $s$update public.assessments set result = 'pass', evidence_assessor_id = (select id from rbac_test.ids where k = 't1_a4'), evidence_reference = 'SHEET-T1-002' where id = (select id from rbac_test.ids where k = 't1_l2')$s$,
  'SKIP', 'V=SA,TR,TO,AT'),
 ('W26', 'evidence: reference shorter than 3 characters',
  $s$insert into public.assessments (schedule_id, participant_id, result, evidence_assessor_id, evidence_reference) values ((select id from rbac_test.ids where k = 't1_s'), (select id from rbac_test.ids where k = 't1_p1'), 'pass', (select id from rbac_test.ids where k = 't1_a1'), ' ab ')$s$,
  'SKIP', 'V=SA,TR,TO,AT'),
 ('W27', 'data-entry actor is forced to the signed-in user (payload names another staff id)',
  $s$with i as (insert into public.assessments (schedule_id, participant_id, result, assessor_id, evidence_assessor_id, evidence_reference) values ((select id from rbac_test.ids where k = 't1_s'), (select id from rbac_test.ids where k = 't1_p1'), 'pass', (select uid from rbac_test.persona where code = 'DA'), (select id from rbac_test.ids where k = 't1_a1'), 'SHEET-T1-003') returning assessor_id) select (assessor_id = auth.uid())::text from i$s$,
  'SKIP', 'A=TR,TO,AT'),
 ('W28', 'edit a LEGACY result without evidence',
  $s$update public.assessments set remarks = 'edited' where id = (select id from rbac_test.ids where k = 't1_l2')$s$,
  'A=SA,TR,AT', 'A=SA V=TR,TO,AT'),
 ('W29', 'edit a LEGACY result adding the schedule Assessor + evidence',
  $s$update public.assessments set remarks = 'edited', evidence_assessor_id = (select id from rbac_test.ids where k = 't1_a1'), evidence_reference = 'SHEET-T1-004' where id = (select id from rbac_test.ids where k = 't1_l2')$s$,
  'SKIP', 'A=SA,TR,TO,AT'),
 ('W30', 'archive a result (deleted_at) - Admin floor',
  $s$update public.assessments set deleted_at = now() where id = (select id from rbac_test.ids where k = 't1_l2')$s$,
  'A=SA,TR,AT', 'A=SA,AT'),
 ('W31', 'FINALISE (lock) a result - Super Admin only',
  $s$update public.assessments set locked = true, locked_at = now(), locked_by = auth.uid() where id = (select id from rbac_test.ids where k = 't1_l2')$s$,
  'A=SA,TR,AT', 'A=SA'),
 ('W32', 'change a LOCKED result (immutable for everyone)',
  $s$update public.assessments set remarks = 'tamper' where id = (select id from rbac_test.ids where k = 't1_l4')$s$,
  'A=', 'A='),
 ('W33', 'unlock - Super Admin only (unchanged)',
  $s$update public.assessments set locked = false, locked_at = null, locked_by = null where id = (select id from rbac_test.ids where k = 't1_l4')$s$,
  'A=SA', 'A=SA'),
 ('W34', 'change evidence on a LOCKED result (immutable, Super Admin too)',
  $s$update public.assessments set evidence_reference = 'SHEET-T1-X' where id = (select id from rbac_test.ids where k = 't1_l4')$s$,
  'SKIP', 'A='),
 ('W35', 'DELETE an assessment (unchanged: Admin + Assessment admin)',
  $s$delete from public.assessments where id = (select id from rbac_test.ids where k = 't1_l2')$s$,
  'A=SA', 'A=SA'),
 ('W36', 'INSERT an already LOCKED assessment (lock on insert)',
  $s$insert into public.assessments (schedule_id, participant_id, result, locked, locked_at, locked_by, evidence_assessor_id, evidence_reference) values ((select id from rbac_test.ids where k = 't1_s'), (select id from rbac_test.ids where k = 't1_p1'), 'pass', true, now(), auth.uid(), (select id from rbac_test.ids where k = 't1_a1'), 'SHEET-T1-005')$s$,
  'SKIP', 'A=SA'),
 -- ---------------------------------------------------------------- skill results
 ('W40', 'INSERT skill result with Assessor + evidence',
  $s$insert into public.participant_skill_results (schedule_id, participant_id, area, status, evidence_assessor_id, evidence_reference) values ((select id from rbac_test.ids where k = 't1_s'), (select id from rbac_test.ids where k = 't1_p1'), 'practical_training', 'completed', (select id from rbac_test.ids where k = 't1_a1'), 'SHEET-T1-006')$s$,
  'SKIP', 'A=SA,TR,TO,AT'),
 ('W41', 'INSERT skill result WITHOUT evidence',
  $s$insert into public.participant_skill_results (schedule_id, participant_id, area, status) values ((select id from rbac_test.ids where k = 't1_s'), (select id from rbac_test.ids where k = 't1_p1'), 'practical_training', 'completed')$s$,
  'A=SA,TR,AT', 'A=SA V=TR,TO,AT'),
 ('W42', 'skill result while the participant''s assessment is LOCKED',
  $s$insert into public.participant_skill_results (schedule_id, participant_id, area, status, evidence_assessor_id, evidence_reference) values ((select id from rbac_test.ids where k = 't1_s'), (select id from rbac_test.ids where k = 't1_p4'), 'practical_training', 'completed', (select id from rbac_test.ids where k = 't1_a1'), 'SHEET-T1-007')$s$,
  'SKIP', 'A=SA'),
 ('W43', 'lock a skill result - Super Admin only',
  $s$insert into public.participant_skill_results (schedule_id, participant_id, area, status, locked, evidence_assessor_id, evidence_reference) values ((select id from rbac_test.ids where k = 't1_s'), (select id from rbac_test.ids where k = 't1_p1'), 'safety_awareness', 'completed', true, (select id from rbac_test.ids where k = 't1_a1'), 'SHEET-T1-008')$s$,
  'SKIP', 'A=SA'),
 ('W44', 'DELETE a skill result (unchanged: Admin + Assessment admin)',
  $s$delete from public.participant_skill_results where id = (select id from rbac_test.ids where k = 't1_k2')$s$,
  'A=SA', 'A=SA'),
 ('W45', 'archive a skill result without evidence',
  $s$update public.participant_skill_results set deleted_at = now() where id = (select id from rbac_test.ids where k = 't1_k2')$s$,
  'A=SA,TR,AT', 'A=SA V=AT'),
 ('W46', 'archive a skill result with evidence - Admin floor',
  $s$update public.participant_skill_results set deleted_at = now(), evidence_assessor_id = (select id from rbac_test.ids where k = 't1_a1'), evidence_reference = 'SHEET-T1-009' where id = (select id from rbac_test.ids where k = 't1_k2')$s$,
  'SKIP', 'A=SA,AT'),
 -- ---------------------------------------------------------------- C4 / Sales-Finance boundaries for Training Ops personas
 ('C01', 'Training Ops reads certificate records (M-11: Certificates or Participants View)',
  $s$select count(*)::text from public.certificates where id = (select id from rbac_test.ids where k = 'm11_cert')$s$,
  'ONLY=TO,TN,TV,TI A=TO,TV', 'ONLY=TO,TN,TV,TI A=TO,TV'),
 ('C02', 'Training Ops cannot insert certificates',
  $s$insert into public.certificates (certificate_no, participant_name, course_name, issue_date, participant_id, course_id) values ('T1-X', 'x', 'x', current_date, (select id from rbac_test.ids where k = 't1_p1'), (select id from rbac_test.ids where k = 'course'))$s$,
  'ONLY=TO,TV', 'ONLY=TO,TV'),
 ('C03', 'Training Ops cannot change certificate records',
  $s$update public.certificates set status = 'revoked' where id = (select id from rbac_test.ids where k = 'm11_cert')$s$,
  'ONLY=TO,TV', 'ONLY=TO,TV'),
 ('C04', 'public /verify still works for anonymous visitors',
  $s$select count(*)::text from public.verify_and_log('M11-0001', 'number', '192.0.2.9', 'rbac-t1')$s$,
  'ONLY=AN A=AN', 'ONLY=AN A=AN'),
 ('C05', 'Training Ops cannot read invoices',
  $s$select count(*)::text from public.invoices$s$,
  'ONLY=TO,TV,TN', 'ONLY=TO,TV,TN'),
 ('C06', 'Training Ops cannot read Sales leads',
  $s$select count(*)::text from public.sales_lead_metadata$s$,
  'ONLY=TO,TV,TN', 'ONLY=TO,TV,TN'),
 ('C07', 'Training Ops cannot read public registrations (Admin only)',
  $s$select count(*)::text from public.public_registrations$s$,
  'ONLY=TO,TV,TN', 'ONLY=TO,TV,TN'),
 ('C08', 'Training Ops cannot change staff module access (users & access)',
  $s$insert into public.staff_module_access (user_id, module_key, access_level) values (auth.uid(), 'users', 'admin')$s$,
  'ONLY=TO', 'ONLY=TO'),
 ('C09', 'Training Ops cannot call the WAH correction RPC (Super Admin / Admin+assessment admin)',
  $s$select public.correct_wah_failed_practical_assessment((select id from rbac_test.ids where k = 't1_s'), (select id from rbac_test.ids where k = 't1_p1'), 'passed', 'rbac t1 correction attempt', 'REF-T1')::text$s$,
  'ONLY=TO', 'ONLY=TO');

insert into rbac_test.t1_cases values
 -- ---------------------------------------------------------------- F1-a: Attendance Undo and finalised attendance
 ('U01', 'Attendance Undo (DELETE) of a non-finalised participant',
  $s$delete from public.attendance where id = (select id from rbac_test.ids where k = 't1f_at9')$s$,
  'A=SA,TR,AT', 'A=SA,TR,TO,AT'),
 ('U02', 'Attendance Undo of a participant whose assessment is LOCKED (finalised)',
  $s$delete from public.attendance where id = (select id from rbac_test.ids where k = 't1f_at7')$s$,
  'A=SA,TR,AT', 'A=SA'),
 ('U03', 'Attendance Undo of a participant with an issued certificate',
  $s$delete from public.attendance where id = (select id from rbac_test.ids where k = 't1f_at8')$s$,
  'A=SA,TR,AT', 'A=SA'),
 ('U04', 'change the attendance status of a finalised participant (locked assessment)',
  $s$update public.attendance set attendance_status = 'absent' where id = (select id from rbac_test.ids where k = 't1f_at7')$s$,
  'A=SA,TR,AT', 'A=SA'),
 ('U05', 'record new attendance for a participant with an issued certificate',
  $s$insert into public.attendance (schedule_id, participant_id, session_date, attendance_status) values ((select id from rbac_test.ids where k = 't1f_s'), (select id from rbac_test.ids where k = 't1f_p8'), current_date + 1, 'present')$s$,
  'A=SA,TR,AT', 'A=SA'),
 ('U06', 'soft-delete (deleted_at) the attendance of a finalised participant',
  $s$update public.attendance set deleted_at = now() where id = (select id from rbac_test.ids where k = 't1f_at7')$s$,
  'A=SA,TR,AT', 'A=SA'),
 ('U07', 'change the attendance of a non-finalised participant (no regression)',
  $s$update public.attendance set attendance_status = 'absent' where id = (select id from rbac_test.ids where k = 't1f_at9')$s$,
  'A=SA,TR,AT', 'A=SA,TR,TO,AT'),
 -- ---------------------------------------------------------------- F2: finalised (locked) skill result
 ('K01', 'UNLOCK a locked skill result (participant assessment not locked)',
  $s$update public.participant_skill_results set locked = false, locked_at = null, locked_by = null where id = (select id from rbac_test.ids where k = 't1f_k9')$s$,
  'A=SA,TR,AT', 'A=SA'),
 ('K02', 'change a LOCKED skill result without unlocking it',
  $s$update public.participant_skill_results set notes = 'tamper' where id = (select id from rbac_test.ids where k = 't1f_k9')$s$,
  'A=SA,TR,AT', 'A=SA'),
 ('K03', 'unlock and change evidence in one update (locked evidence immutable for everyone)',
  $s$update public.participant_skill_results set locked = false, evidence_reference = 'SHEET-T1-K' where id = (select id from rbac_test.ids where k = 't1f_k9')$s$,
  'SKIP', 'A='),
 ('K04', 'archive (deleted_at) a LOCKED skill result',
  $s$update public.participant_skill_results set deleted_at = now() where id = (select id from rbac_test.ids where k = 't1f_k9')$s$,
  'A=SA,TR,AT', 'A=SA');

insert into rbac_test.t1_cases values
 -- ---------------------------------------------------------------- r4 D-A2: certified participants (issued certificate)
 ('Q01', 'INSERT an assessment for a certified participant without one (p8)',
  $s$insert into public.assessments (schedule_id, participant_id, result, evidence_assessor_id, evidence_reference) values ((select id from rbac_test.ids where k = 't1f_s'), (select id from rbac_test.ids where k = 't1f_p8'), 'fail', (select id from rbac_test.ids where k = 't1_a1'), 'SHEET-R4')$s$,
  'SKIP', 'A=SA'),
 ('Q02', 'INSERT a skill result for a certified participant (p8)',
  $s$insert into public.participant_skill_results (schedule_id, participant_id, area, status, evidence_assessor_id, evidence_reference) values ((select id from rbac_test.ids where k = 't1f_s'), (select id from rbac_test.ids where k = 't1f_p8'), 'practical_training', 'completed', (select id from rbac_test.ids where k = 't1_a1'), 'SHEET-R4')$s$,
  'SKIP', 'A=SA'),
 ('Q03', 'change the (unlocked) assessment of a certified participant',
  $s$update public.assessments set remarks = 'r4 change' where id = (select id from rbac_test.ids where k = 't1f_a10')$s$,
  'A=SA,TR,AT', 'A=SA'),
 ('Q04', 'change the assessment of a certified participant WITH evidence',
  $s$update public.assessments set result = 'fail', evidence_assessor_id = (select id from rbac_test.ids where k = 't1_a1'), evidence_reference = 'SHEET-R4' where id = (select id from rbac_test.ids where k = 't1f_a10')$s$,
  'SKIP', 'A=SA'),
 ('Q05', 'change a skill result of a certified participant',
  $s$update public.participant_skill_results set notes = 'r4 change' where id = (select id from rbac_test.ids where k = 't1f_k10')$s$,
  'A=SA,TR,AT', 'A=SA'),
 ('Q06', 'archive a skill result of a certified participant',
  $s$update public.participant_skill_results set deleted_at = now() where id = (select id from rbac_test.ids where k = 't1f_k10')$s$,
  'A=SA,TR,AT', 'A=SA'),
 ('Q07', 'restore an archived skill result of a certified participant',
  $s$update public.participant_skill_results set deleted_at = null where id = (select id from rbac_test.ids where k = 't1f_k10x')$s$,
  'A=SA,TR,AT', 'A=SA'),
 -- ---------------------------------------------------------------- r4 D-A3: re-pointing is refused for every role
 ('X01', 're-point an assessment to another participant (p2 -> p1)',
  $s$update public.assessments set participant_id = (select id from rbac_test.ids where k = 't1_p1') where id = (select id from rbac_test.ids where k = 't1_l2')$s$,
  'A=SA,TR,AT', 'A='),
 ('X02', 're-point a skill result to another participant (p2 -> p1)',
  $s$update public.participant_skill_results set participant_id = (select id from rbac_test.ids where k = 't1_p1') where id = (select id from rbac_test.ids where k = 't1_k2')$s$,
  'A=SA,TR,AT', 'A='),
 ('X03', 're-point an assessment WITH evidence (no bypass through the evidence path)',
  $s$update public.assessments set participant_id = (select id from rbac_test.ids where k = 't1_p1'), evidence_assessor_id = (select id from rbac_test.ids where k = 't1_a1'), evidence_reference = 'SHEET-R4' where id = (select id from rbac_test.ids where k = 't1_l2')$s$,
  'SKIP', 'A=');

create or replace function rbac_test.t1_expect(p_exp text, p_code text) returns text language plpgsql immutable as $$
declare tok text; k text; v text; only_set text := null;
begin
  if p_exp = 'SKIP' then return '-'; end if;
  foreach tok in array regexp_split_to_array(btrim(p_exp), '\s+') loop
    k := split_part(tok, '=', 1); v := split_part(tok, '=', 2);
    if k = 'ONLY' then only_set := v; end if;
  end loop;
  if only_set is not null and not (p_code = any (string_to_array(only_set, ','))) then return '-'; end if;
  foreach tok in array regexp_split_to_array(btrim(p_exp), '\s+') loop
    k := split_part(tok, '=', 1); v := split_part(tok, '=', 2);
    if k in ('A', 'V', 'X') and (v = '*' or p_code = any (string_to_array(v, ','))) then return k; end if;
  end loop;
  return 'D';
end $$;

create or replace function rbac_test.t1_classify(p_res text) returns text language sql immutable as $$
  select case when p_res ~ '^err:23514' then 'V' else rbac_test.classify(p_res) end;
$$;

create or replace function rbac_test.t1(p_stage text) returns table (pass int, fail int) language plpgsql as $$
declare
  c record; codes text[] := array['SA','DA','SS','FS','MG','RD','CE','VO','NG','TR','IN','LS','LF','LM','AN','TO','TN','TI','TV','AT'];
  i int; e text; got text; res text; grid text; np int := 0; nf int := 0;
begin
  for c in select * from rbac_test.t1_cases order by id loop
    grid := '';
    for i in 1..array_length(codes, 1) loop
      e := rbac_test.t1_expect(case when p_stage = 'F' then c.post else c.pre end, codes[i]);
      if e = '-' then grid := grid || '-'; continue; end if;
      res := rbac_test.probe(codes[i], c.sql);
      got := rbac_test.t1_classify(res);
      grid := grid || got;
      if got = e then np := np + 1;
      else nf := nf + 1; raise notice 'FAIL T1 % % % expected % got % (%)', p_stage, c.id, codes[i], e, got, res; end if;
    end loop;
    raise notice 'GRID T1 % % % | %', p_stage, c.id, grid, c.descr;
  end loop;
  raise notice 'TOTAL T1 % pass=% fail=%', p_stage, np, nf;
  return query select np, nf;
end $$;
