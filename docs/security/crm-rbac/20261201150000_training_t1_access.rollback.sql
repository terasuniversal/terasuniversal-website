-- ROLLBACK for 20261201150000_training_t1_access.sql (local design artefact; separate Owner approval required to run anywhere).
-- Restores the previous policies, helper bodies and removes the three audit triggers added by T1-a.
set local lock_timeout = '5s';
drop trigger if exists trg_courses_audit on public.courses;
drop trigger if exists trg_assessors_audit on public.assessors;
drop trigger if exists trg_downloads_audit on public.downloads;

CREATE OR REPLACE FUNCTION app.can_manage_trainers()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select app.is_super_admin()
    or (app.has_min_role('admin'::public.user_role) and public.has_module_access_level('trainers', 'view'));
$function$;

CREATE OR REPLACE FUNCTION app.can_manage_assessors()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.has_module_access_level('assessors', 'admin');
$function$;

CREATE OR REPLACE FUNCTION app.can_manage_schedule_assessors()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.has_module_access_level('schedules', 'admin')
     and public.has_module_access('assessors');
$function$;

CREATE OR REPLACE FUNCTION app.can_manage_schedule_groups()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select app.is_super_admin()
    or (app.has_min_role('admin'::public.user_role) and public.has_module_access_level('schedules', 'admin'));
$function$;

drop policy if exists assessors_read on public.assessors;
create policy assessors_read on public.assessors as permissive for select to authenticated
  using (app.is_active());

drop policy if exists schedule_assessors_read on public.schedule_assessors;
create policy schedule_assessors_read on public.schedule_assessors as permissive for select to authenticated
  using (app.is_active());

drop policy if exists schedule_groups_read on public.schedule_groups;
create policy schedule_groups_read on public.schedule_groups as permissive for select to authenticated
  using (app.is_active());

drop policy if exists course_schedules_insert on public.course_schedules;
create policy course_schedules_insert on public.course_schedules as permissive for insert to authenticated
  with check ((app.is_admin() AND ( SELECT has_module_access_level('schedules'::text, 'edit'::text) AS has_module_access_level)));

drop policy if exists course_schedules_update on public.course_schedules;
create policy course_schedules_update on public.course_schedules as permissive for update to authenticated
  using ((app.is_admin() AND ( SELECT has_module_access_level('schedules'::text, 'edit'::text) AS has_module_access_level)))
  with check ((app.is_admin() AND ( SELECT has_module_access_level('schedules'::text, 'edit'::text) AS has_module_access_level)));

drop policy if exists schedule_participants_insert on public.schedule_participants;
create policy schedule_participants_insert on public.schedule_participants as permissive for insert to authenticated
  with check ((app.is_admin() AND ( SELECT has_module_access_level('schedules'::text, 'edit'::text) AS has_module_access_level)));

drop policy if exists schedule_participants_update on public.schedule_participants;
create policy schedule_participants_update on public.schedule_participants as permissive for update to authenticated
  using ((app.is_admin() AND ( SELECT has_module_access_level('schedules'::text, 'edit'::text) AS has_module_access_level)))
  with check ((app.is_admin() AND ( SELECT has_module_access_level('schedules'::text, 'edit'::text) AS has_module_access_level)));

drop policy if exists participants_insert on public.participants;
create policy participants_insert on public.participants as permissive for insert to authenticated
  with check ((app.is_admin() AND ( SELECT has_module_access_level('participants'::text, 'edit'::text) AS has_module_access_level)));

drop policy if exists participants_update on public.participants;
create policy participants_update on public.participants as permissive for update to authenticated
  using ((app.is_admin() AND ( SELECT has_module_access_level('participants'::text, 'edit'::text) AS has_module_access_level)))
  with check ((app.is_admin() AND ( SELECT has_module_access_level('participants'::text, 'edit'::text) AS has_module_access_level)));

drop policy if exists attendance_insert on public.attendance;
create policy attendance_insert on public.attendance as permissive for insert to authenticated
  with check (((app.is_admin() AND ( SELECT has_module_access_level('attendance'::text, 'edit'::text) AS has_module_access_level)) OR (app.is_admin_or_trainer() AND (NOT app.is_admin()))));

drop policy if exists attendance_update on public.attendance;
create policy attendance_update on public.attendance as permissive for update to authenticated
  using (((app.is_admin() AND ( SELECT has_module_access_level('attendance'::text, 'edit'::text) AS has_module_access_level)) OR (app.is_admin_or_trainer() AND (NOT app.is_admin()))))
  with check (((app.is_admin() AND ( SELECT has_module_access_level('attendance'::text, 'edit'::text) AS has_module_access_level)) OR (app.is_admin_or_trainer() AND (NOT app.is_admin()))));

drop policy if exists attendance_delete on public.attendance;
create policy attendance_delete on public.attendance as permissive for delete to authenticated
  using (((app.is_admin() AND ( SELECT has_module_access_level('attendance'::text, 'edit'::text) AS has_module_access_level)) OR (app.is_admin_or_trainer() AND (NOT app.is_admin()))));

drop policy if exists assessments_insert on public.assessments;
create policy assessments_insert on public.assessments as permissive for insert to authenticated
  with check (((app.is_admin() AND ( SELECT has_module_access_level('assessment'::text, 'edit'::text) AS has_module_access_level)) OR (app.is_admin_or_trainer() AND (NOT app.is_admin()))));

drop policy if exists assessments_update_unlocked on public.assessments;
create policy assessments_update_unlocked on public.assessments as permissive for update to authenticated
  using ((((app.is_admin() AND ( SELECT has_module_access_level('assessment'::text, 'edit'::text) AS has_module_access_level)) OR (app.is_admin_or_trainer() AND (NOT app.is_admin()))) AND (locked = false)))
  with check (((app.is_admin() AND ( SELECT has_module_access_level('assessment'::text, 'edit'::text) AS has_module_access_level)) OR (app.is_admin_or_trainer() AND (NOT app.is_admin()))));

drop policy if exists participant_skill_results_insert on public.participant_skill_results;
create policy participant_skill_results_insert on public.participant_skill_results as permissive for insert to authenticated
  with check (((app.is_admin() AND ( SELECT has_module_access_level('assessment'::text, 'edit'::text) AS has_module_access_level)) OR (app.is_admin_or_trainer() AND (NOT app.is_admin()))));

drop policy if exists participant_skill_results_update on public.participant_skill_results;
create policy participant_skill_results_update on public.participant_skill_results as permissive for update to authenticated
  using (((app.is_admin() AND ( SELECT has_module_access_level('assessment'::text, 'edit'::text) AS has_module_access_level)) OR (app.is_admin_or_trainer() AND (NOT app.is_admin()))))
  with check (((app.is_admin() AND ( SELECT has_module_access_level('assessment'::text, 'edit'::text) AS has_module_access_level)) OR (app.is_admin_or_trainer() AND (NOT app.is_admin()))));
