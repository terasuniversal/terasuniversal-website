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
