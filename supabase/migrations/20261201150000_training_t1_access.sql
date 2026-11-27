-- Training T1-a: Training Operations Staff access (Editor + explicit module capability; no Admin role needed).
-- Approval: OWNER-TRAINING-T1-20261125. LOCAL AND DOCKER ONLY until a separate GO.
-- Before: every Training write (schedules, enrolments, participants, attendance, assessments, skill results) required
-- the Admin role (app.is_admin() AND module), so Training work could only be delegated by granting Admin - which also
-- opens the Admin-only public-registration, legacy and profile reads (F-04). Trainers/assessors/schedule assessor and
-- group management required Admin or an Admin-level module grant. public.assessors (identity number, phone, e-mail)
-- and the schedule assessor/group assignments were readable by ANY active account (S-1).
-- After:
--  * writes use app.can_module(<module>, 'edit') - active, catalog-active, Admin OR Editor with Custom access, and the
--    explicit module grant. Admin/Super Admin keep exactly their previous access. The Trainer branch on attendance /
--    assessments / skill results is kept unchanged (no Trainer accounts exist; nothing is widened for trainers).
--  * attendance_delete IS changed (F1-a, Owner-approved): it backs Attendance Undo (resetAttendance returns a session
--    mark to "not recorded"; the live enum has no pending value), so it follows Attendance Edit like insert/update.
--    The postcondition pins its exact text, and 20261201151000 keeps finalised attendance (locked assessment or an
--    issued certificate) Super Admin only and writes a detailed audit row for every Undo.
--  * Every other DELETE policy, assessments_update_super_admin and all certificate objects are NOT changed
--    (Admin-level grants, which Training Ops Staff does not hold, are still required to delete).
--  * S-1: assessors SELECT requires Assessors View; schedule_assessors / schedule_groups SELECT require a Training
--    module (schedules, attendance, assessment, assessors or dashboard) above the trainer floor.
--  * helpers: can_manage_trainers = Trainers Edit, can_manage_assessors = Assessors Edit (adds the missing Editor
--    floor), can_manage_schedule_assessors = Schedules Edit + Assessors View, can_manage_schedule_groups = Schedules Edit.
--  * audit trigger (existing app.audit_trigger) added to courses, assessors and downloads.
-- Requires 20261201110000 (app.can_module) and 20261201140000 (M-11).

do $t1a_requires$
declare r record;
begin
  if to_regprocedure('app.can_module(text,text)') is null or to_regprocedure('app.has_any_module_access(text[],text)') is null then
    raise exception 't1a_precondition_failed: app.can_module / app.has_any_module_access missing - nothing changed' using errcode = 'P0001';
  end if;
  for r in select * from (values
      ($q$can_manage_trainers$q$, $q$56533ab638e1392af8480f4fc37c2b58$q$),
      ($q$can_manage_assessors$q$, $q$408b150b50bfdd3499816a16ae59f040$q$),
      ($q$can_manage_schedule_assessors$q$, $q$e73a63bb60f652676585e13a6868f6b9$q$),
      ($q$can_manage_schedule_groups$q$, $q$734b1aefcf8130124991dffd82dd2a83$q$)
    ) as t(fn, md5) loop
    if (select md5(p.prosrc) from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname = r.fn) is distinct from r.md5 then
      raise exception 't1a_precondition_failed: app.% body is not the reviewed pre-state - nothing changed', r.fn using errcode = 'P0001';
    end if;
  end loop;
  for r in select * from unnest(array['courses', 'assessors', 'downloads']) as u(tbl) loop
    if exists (select 1 from pg_trigger where tgrelid = ('public.' || r.tbl)::regclass and tgname = 'trg_' || r.tbl || '_audit') then
      raise exception 't1a_precondition_failed: trg_%_audit already exists - nothing changed', r.tbl using errcode = 'P0001';
    end if;
  end loop;
end;
$t1a_requires$;

set local lock_timeout = '5s';

do $t1a_pre$
declare r record;
begin
  for r in
    select * from (values
      ($q$assessors$q$, $q$assessors_read$q$, $q$SELECT$q$, $q$authenticated$q$, $q$app.is_active()$q$, null),
      ($q$schedule_assessors$q$, $q$schedule_assessors_read$q$, $q$SELECT$q$, $q$authenticated$q$, $q$app.is_active()$q$, null),
      ($q$schedule_groups$q$, $q$schedule_groups_read$q$, $q$SELECT$q$, $q$authenticated$q$, $q$app.is_active()$q$, null),
      ($q$course_schedules$q$, $q$course_schedules_insert$q$, $q$INSERT$q$, $q$authenticated$q$, null, $q$(app.is_admin() AND ( SELECT has_module_access_level('schedules'::text, 'edit'::text) AS has_module_access_level))$q$),
      ($q$course_schedules$q$, $q$course_schedules_update$q$, $q$UPDATE$q$, $q$authenticated$q$, $q$(app.is_admin() AND ( SELECT has_module_access_level('schedules'::text, 'edit'::text) AS has_module_access_level))$q$, $q$(app.is_admin() AND ( SELECT has_module_access_level('schedules'::text, 'edit'::text) AS has_module_access_level))$q$),
      ($q$schedule_participants$q$, $q$schedule_participants_insert$q$, $q$INSERT$q$, $q$authenticated$q$, null, $q$(app.is_admin() AND ( SELECT has_module_access_level('schedules'::text, 'edit'::text) AS has_module_access_level))$q$),
      ($q$schedule_participants$q$, $q$schedule_participants_update$q$, $q$UPDATE$q$, $q$authenticated$q$, $q$(app.is_admin() AND ( SELECT has_module_access_level('schedules'::text, 'edit'::text) AS has_module_access_level))$q$, $q$(app.is_admin() AND ( SELECT has_module_access_level('schedules'::text, 'edit'::text) AS has_module_access_level))$q$),
      ($q$participants$q$, $q$participants_insert$q$, $q$INSERT$q$, $q$authenticated$q$, null, $q$(app.is_admin() AND ( SELECT has_module_access_level('participants'::text, 'edit'::text) AS has_module_access_level))$q$),
      ($q$participants$q$, $q$participants_update$q$, $q$UPDATE$q$, $q$authenticated$q$, $q$(app.is_admin() AND ( SELECT has_module_access_level('participants'::text, 'edit'::text) AS has_module_access_level))$q$, $q$(app.is_admin() AND ( SELECT has_module_access_level('participants'::text, 'edit'::text) AS has_module_access_level))$q$),
      ($q$attendance$q$, $q$attendance_insert$q$, $q$INSERT$q$, $q$authenticated$q$, null, $q$((app.is_admin() AND ( SELECT has_module_access_level('attendance'::text, 'edit'::text) AS has_module_access_level)) OR (app.is_admin_or_trainer() AND (NOT app.is_admin())))$q$),
      ($q$attendance$q$, $q$attendance_update$q$, $q$UPDATE$q$, $q$authenticated$q$, $q$((app.is_admin() AND ( SELECT has_module_access_level('attendance'::text, 'edit'::text) AS has_module_access_level)) OR (app.is_admin_or_trainer() AND (NOT app.is_admin())))$q$, $q$((app.is_admin() AND ( SELECT has_module_access_level('attendance'::text, 'edit'::text) AS has_module_access_level)) OR (app.is_admin_or_trainer() AND (NOT app.is_admin())))$q$),
      ($q$attendance$q$, $q$attendance_delete$q$, $q$DELETE$q$, $q$authenticated$q$, $q$((app.is_admin() AND ( SELECT has_module_access_level('attendance'::text, 'edit'::text) AS has_module_access_level)) OR (app.is_admin_or_trainer() AND (NOT app.is_admin())))$q$, null),
      ($q$assessments$q$, $q$assessments_insert$q$, $q$INSERT$q$, $q$authenticated$q$, null, $q$((app.is_admin() AND ( SELECT has_module_access_level('assessment'::text, 'edit'::text) AS has_module_access_level)) OR (app.is_admin_or_trainer() AND (NOT app.is_admin())))$q$),
      ($q$assessments$q$, $q$assessments_update_unlocked$q$, $q$UPDATE$q$, $q$authenticated$q$, $q$(((app.is_admin() AND ( SELECT has_module_access_level('assessment'::text, 'edit'::text) AS has_module_access_level)) OR (app.is_admin_or_trainer() AND (NOT app.is_admin()))) AND (locked = false))$q$, $q$((app.is_admin() AND ( SELECT has_module_access_level('assessment'::text, 'edit'::text) AS has_module_access_level)) OR (app.is_admin_or_trainer() AND (NOT app.is_admin())))$q$),
      ($q$participant_skill_results$q$, $q$participant_skill_results_insert$q$, $q$INSERT$q$, $q$authenticated$q$, null, $q$((app.is_admin() AND ( SELECT has_module_access_level('assessment'::text, 'edit'::text) AS has_module_access_level)) OR (app.is_admin_or_trainer() AND (NOT app.is_admin())))$q$),
      ($q$participant_skill_results$q$, $q$participant_skill_results_update$q$, $q$UPDATE$q$, $q$authenticated$q$, $q$((app.is_admin() AND ( SELECT has_module_access_level('assessment'::text, 'edit'::text) AS has_module_access_level)) OR (app.is_admin_or_trainer() AND (NOT app.is_admin())))$q$, $q$((app.is_admin() AND ( SELECT has_module_access_level('assessment'::text, 'edit'::text) AS has_module_access_level)) OR (app.is_admin_or_trainer() AND (NOT app.is_admin())))$q$)
    ) as t(tbl, pol, cmd, roles, qual, chk)
  loop
    if not exists (select 1 from pg_policies p
                   where p.schemaname = 'public' and p.tablename = r.tbl and p.policyname = r.pol and p.cmd = r.cmd
                     and array_to_string(p.roles, ',') = r.roles and p.permissive = 'PERMISSIVE'
                     and p.qual is not distinct from r.qual and p.with_check is not distinct from r.chk) then
      raise exception 't1a_precondition_failed: policy %.% is not the reviewed pre-state - nothing changed', r.tbl, r.pol using errcode = 'P0001';
    end if;
  end loop;
end;
$t1a_pre$;

create or replace function app.can_manage_trainers()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select app.can_module('trainers', 'edit');
$function$;

create or replace function app.can_manage_assessors()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select app.can_module('assessors', 'edit');
$function$;

create or replace function app.can_manage_schedule_assessors()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select app.can_module('schedules', 'edit') and app.can_module('assessors', 'view');
$function$;

create or replace function app.can_manage_schedule_groups()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select app.can_module('schedules', 'edit');
$function$;

drop policy if exists assessors_read on public.assessors;
create policy assessors_read on public.assessors as permissive for select to authenticated
  using (( SELECT app.can_module('assessors'::text, 'view'::text) AS can_module));

drop policy if exists schedule_assessors_read on public.schedule_assessors;
create policy schedule_assessors_read on public.schedule_assessors as permissive for select to authenticated
  using ((app.has_min_role('trainer'::public.user_role) AND ( SELECT app.has_any_module_access(ARRAY['schedules'::text, 'attendance'::text, 'assessment'::text, 'assessors'::text, 'dashboard'::text], 'view'::text) AS has_any_module_access)));

drop policy if exists schedule_groups_read on public.schedule_groups;
create policy schedule_groups_read on public.schedule_groups as permissive for select to authenticated
  using ((app.has_min_role('trainer'::public.user_role) AND ( SELECT app.has_any_module_access(ARRAY['schedules'::text, 'attendance'::text, 'assessment'::text, 'assessors'::text, 'dashboard'::text], 'view'::text) AS has_any_module_access)));

drop policy if exists course_schedules_insert on public.course_schedules;
create policy course_schedules_insert on public.course_schedules as permissive for insert to authenticated
  with check (( SELECT app.can_module('schedules'::text, 'edit'::text) AS can_module));

drop policy if exists course_schedules_update on public.course_schedules;
create policy course_schedules_update on public.course_schedules as permissive for update to authenticated
  using (( SELECT app.can_module('schedules'::text, 'edit'::text) AS can_module))
  with check (( SELECT app.can_module('schedules'::text, 'edit'::text) AS can_module));

drop policy if exists schedule_participants_insert on public.schedule_participants;
create policy schedule_participants_insert on public.schedule_participants as permissive for insert to authenticated
  with check (( SELECT app.can_module('schedules'::text, 'edit'::text) AS can_module));

drop policy if exists schedule_participants_update on public.schedule_participants;
create policy schedule_participants_update on public.schedule_participants as permissive for update to authenticated
  using (( SELECT app.can_module('schedules'::text, 'edit'::text) AS can_module))
  with check (( SELECT app.can_module('schedules'::text, 'edit'::text) AS can_module));

drop policy if exists participants_insert on public.participants;
create policy participants_insert on public.participants as permissive for insert to authenticated
  with check (( SELECT app.can_module('participants'::text, 'edit'::text) AS can_module));

drop policy if exists participants_update on public.participants;
create policy participants_update on public.participants as permissive for update to authenticated
  using (( SELECT app.can_module('participants'::text, 'edit'::text) AS can_module))
  with check (( SELECT app.can_module('participants'::text, 'edit'::text) AS can_module));

drop policy if exists attendance_insert on public.attendance;
create policy attendance_insert on public.attendance as permissive for insert to authenticated
  with check ((( SELECT app.can_module('attendance'::text, 'edit'::text) AS can_module) OR (app.is_admin_or_trainer() AND (NOT app.is_admin()))));

drop policy if exists attendance_update on public.attendance;
create policy attendance_update on public.attendance as permissive for update to authenticated
  using ((( SELECT app.can_module('attendance'::text, 'edit'::text) AS can_module) OR (app.is_admin_or_trainer() AND (NOT app.is_admin()))))
  with check ((( SELECT app.can_module('attendance'::text, 'edit'::text) AS can_module) OR (app.is_admin_or_trainer() AND (NOT app.is_admin()))));

drop policy if exists attendance_delete on public.attendance;
create policy attendance_delete on public.attendance as permissive for delete to authenticated
  using ((( SELECT app.can_module('attendance'::text, 'edit'::text) AS can_module) OR (app.is_admin_or_trainer() AND (NOT app.is_admin()))));

drop policy if exists assessments_insert on public.assessments;
create policy assessments_insert on public.assessments as permissive for insert to authenticated
  with check ((( SELECT app.can_module('assessment'::text, 'edit'::text) AS can_module) OR (app.is_admin_or_trainer() AND (NOT app.is_admin()))));

drop policy if exists assessments_update_unlocked on public.assessments;
create policy assessments_update_unlocked on public.assessments as permissive for update to authenticated
  using (((( SELECT app.can_module('assessment'::text, 'edit'::text) AS can_module) OR (app.is_admin_or_trainer() AND (NOT app.is_admin()))) AND (locked = false)))
  with check ((( SELECT app.can_module('assessment'::text, 'edit'::text) AS can_module) OR (app.is_admin_or_trainer() AND (NOT app.is_admin()))));

drop policy if exists participant_skill_results_insert on public.participant_skill_results;
create policy participant_skill_results_insert on public.participant_skill_results as permissive for insert to authenticated
  with check ((( SELECT app.can_module('assessment'::text, 'edit'::text) AS can_module) OR (app.is_admin_or_trainer() AND (NOT app.is_admin()))));

drop policy if exists participant_skill_results_update on public.participant_skill_results;
create policy participant_skill_results_update on public.participant_skill_results as permissive for update to authenticated
  using ((( SELECT app.can_module('assessment'::text, 'edit'::text) AS can_module) OR (app.is_admin_or_trainer() AND (NOT app.is_admin()))))
  with check ((( SELECT app.can_module('assessment'::text, 'edit'::text) AS can_module) OR (app.is_admin_or_trainer() AND (NOT app.is_admin()))));

create trigger trg_courses_audit after insert or delete or update on public.courses for each row execute function app.audit_trigger();
create trigger trg_assessors_audit after insert or delete or update on public.assessors for each row execute function app.audit_trigger();
create trigger trg_downloads_audit after insert or delete or update on public.downloads for each row execute function app.audit_trigger();

do $t1a_post$
declare r record;
begin
  -- every changed policy now uses the module capability helpers and none still relies on app.is_active() alone
  for r in select * from (values ($q$assessors$q$, $q$assessors_read$q$), ($q$schedule_assessors$q$, $q$schedule_assessors_read$q$), ($q$schedule_groups$q$, $q$schedule_groups_read$q$), ($q$course_schedules$q$, $q$course_schedules_insert$q$), ($q$course_schedules$q$, $q$course_schedules_update$q$), ($q$schedule_participants$q$, $q$schedule_participants_insert$q$), ($q$schedule_participants$q$, $q$schedule_participants_update$q$), ($q$participants$q$, $q$participants_insert$q$), ($q$participants$q$, $q$participants_update$q$), ($q$attendance$q$, $q$attendance_insert$q$), ($q$attendance$q$, $q$attendance_update$q$), ($q$attendance$q$, $q$attendance_delete$q$), ($q$assessments$q$, $q$assessments_insert$q$), ($q$assessments$q$, $q$assessments_update_unlocked$q$), ($q$participant_skill_results$q$, $q$participant_skill_results_insert$q$), ($q$participant_skill_results$q$, $q$participant_skill_results_update$q$)) as t(tbl, pol) loop
    if not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = r.tbl and p.policyname = r.pol
                   and (position('can_module' in coalesce(p.qual, '') || coalesce(p.with_check, '')) > 0
                        or position('has_any_module_access' in coalesce(p.qual, '')) > 0)) then
      raise exception 't1a_postcondition_failed: policy %.% is not as intended', r.tbl, r.pol using errcode = 'P0001';
    end if;
  end loop;
  -- S-1: exactly one SELECT policy for anon/authenticated on the assessor tables, and none is app.is_active() alone
  for r in select * from unnest(array['assessors', 'schedule_assessors', 'schedule_groups']) as u(tbl) loop
    if (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = r.tbl and p.cmd in ('SELECT', 'ALL')
          and p.roles && array['public', 'anon', 'authenticated']::name[]) <> 1
       or exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = r.tbl and p.cmd in ('SELECT', 'ALL')
                  and p.roles && array['public', 'anon', 'authenticated']::name[] and btrim(p.qual) = 'app.is_active()') then
      raise exception 't1a_postcondition_failed: % still has an open or duplicate SELECT policy', r.tbl using errcode = 'P0001';
    end if;
  end loop;
  -- F1-a: attendance has exactly one DELETE-capable policy for client roles, and it is exactly the approved text
  if (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'attendance' and p.cmd in ('DELETE', 'ALL')
        and p.roles && array['public', 'anon', 'authenticated']::name[]) <> 1
     or not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = 'attendance'
                    and p.policyname = 'attendance_delete' and p.cmd = 'DELETE' and p.permissive = 'PERMISSIVE'
                    and array_to_string(p.roles, ',') = 'authenticated' and p.with_check is null
                    and p.qual = $q$(( SELECT app.can_module('attendance'::text, 'edit'::text) AS can_module) OR (app.is_admin_or_trainer() AND (NOT app.is_admin())))$q$) then
    raise exception 't1a_postcondition_failed: attendance_delete is not exactly the approved Attendance Undo policy' using errcode = 'P0001';
  end if;
  -- every other Training DELETE policy is unchanged: still requires an Admin-level module grant
  if (select count(*) from pg_policies p where p.schemaname = 'public' and p.cmd = 'DELETE'
        and p.tablename in ('assessments', 'participant_skill_results', 'course_schedules', 'schedule_participants', 'participants')
        and position('''admin''::text' in p.qual) > 0) <> 5 then
    raise exception 't1a_postcondition_failed: a Training DELETE policy no longer requires an Admin-level grant' using errcode = 'P0001';
  end if;
  for r in select * from unnest(array['courses', 'assessors', 'downloads']) as u(tbl) loop
    if not exists (select 1 from pg_trigger where tgrelid = ('public.' || r.tbl)::regclass and tgname = 'trg_' || r.tbl || '_audit') then
      raise exception 't1a_postcondition_failed: trg_%_audit missing', r.tbl using errcode = 'P0001';
    end if;
  end loop;
end;
$t1a_post$;
