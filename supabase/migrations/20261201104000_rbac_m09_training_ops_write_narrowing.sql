-- RBAC M-09 (D-13): Training Operations writes and destructive DELETEs require the matching module.
-- Finding (read-only, Production 2026-11-24): these write policies checked the role only (app.is_admin() or
-- app.is_admin_or_trainer()). Every active departmental admin (Sales, Finance, Management - none of whom hold any
-- Training module) could insert/update/hard-delete participants, schedules, enrolments, attendance, assessments and
-- skill results through PostgREST; deleting a participant or schedule cascades to attendance, assessments,
-- enrolments, skill results and feedback. Content and course DELETE was likewise role-only (courses has no audit trigger).
--
-- Rule: each new expression = the previous role condition AND a module condition. Nothing is widened.
--   * INSERT/UPDATE: module at Edit.  DELETE: module at Admin (no application path hard-deletes these rows; the
--     app soft-deletes via UPDATE deleted_at), except attendance DELETE which stays at Edit (attendance reset).
--   * Trainer branch unchanged: (app.is_admin_or_trainer() AND NOT app.is_admin()) is exactly what the old
--     is_admin_or_trainer() admitted beyond admins. Trainer scoping (M6) remains backlog.
--   * Module keys follow the Server Actions that legitimately write each table:
--       participants -> participants      schedule_participants, course_schedules -> schedules
--       (the sync_schedule_seats trigger runs as the invoker and updates course_schedules when enrolments change;
--        both tables therefore use the schedules module so legitimate enrolment keeps working)
--       attendance -> attendance  assessments, participant_skill_results -> assessment
--       certificate_templates -> certificate_templates or certificates (the templates screen guards 'certificates')
--       course_commercial_profiles -> courses  legacy_* -> legacy_import at Admin (matches the legacy-import actions)
--       certificate_import_logs -> certificates  courses/news_posts/faqs/downloads/gallery_images/media DELETE -> own module
--   * The seven SECURITY DEFINER legacy_* RPCs get the same legacy_import Admin condition on their single
--     'if not app.is_admin() then' gate (body otherwise byte-for-byte unchanged; see the gate block below).
-- NOT changed: SELECT policies, assessments_update_super_admin, certificate/verification functions and routes,
-- SECURITY DEFINER registration finalisation (owner postgres bypasses RLS), triggers, grants.
-- Super Admin passes everywhere through has_module_access_level. Staff without access control keep role-default access.
-- Approval: OWNER-CRM-RBAC-DEV-20261124 (local development; not applied anywhere).

set local lock_timeout = '5s';

do $m09_pre$
declare r record;
begin
  for r in
    select * from (values
      ($q$participants$q$, $q$participants_insert$q$, $q$INSERT$q$, $q$authenticated$q$, null, $q$app.is_admin()$q$),
      ($q$participants$q$, $q$participants_update$q$, $q$UPDATE$q$, $q$authenticated$q$, $q$app.is_admin()$q$, $q$app.is_admin()$q$),
      ($q$participants$q$, $q$participants_delete$q$, $q$DELETE$q$, $q$authenticated$q$, $q$app.is_admin()$q$, null),
      ($q$schedule_participants$q$, $q$schedule_participants_insert$q$, $q$INSERT$q$, $q$authenticated$q$, null, $q$app.is_admin()$q$),
      ($q$schedule_participants$q$, $q$schedule_participants_update$q$, $q$UPDATE$q$, $q$authenticated$q$, $q$app.is_admin()$q$, $q$app.is_admin()$q$),
      ($q$schedule_participants$q$, $q$schedule_participants_delete$q$, $q$DELETE$q$, $q$authenticated$q$, $q$app.is_admin()$q$, null),
      ($q$course_schedules$q$, $q$course_schedules_insert$q$, $q$INSERT$q$, $q$authenticated$q$, null, $q$app.is_admin()$q$),
      ($q$course_schedules$q$, $q$course_schedules_update$q$, $q$UPDATE$q$, $q$authenticated$q$, $q$app.is_admin()$q$, $q$app.is_admin()$q$),
      ($q$course_schedules$q$, $q$course_schedules_delete$q$, $q$DELETE$q$, $q$authenticated$q$, $q$app.is_admin()$q$, null),
      ($q$attendance$q$, $q$attendance_insert$q$, $q$INSERT$q$, $q$authenticated$q$, null, $q$app.is_admin_or_trainer()$q$),
      ($q$attendance$q$, $q$attendance_update$q$, $q$UPDATE$q$, $q$authenticated$q$, $q$app.is_admin_or_trainer()$q$, $q$app.is_admin_or_trainer()$q$),
      ($q$attendance$q$, $q$attendance_delete$q$, $q$DELETE$q$, $q$authenticated$q$, $q$app.is_admin_or_trainer()$q$, null),
      ($q$assessments$q$, $q$assessments_insert$q$, $q$INSERT$q$, $q$authenticated$q$, null, $q$app.is_admin_or_trainer()$q$),
      ($q$assessments$q$, $q$assessments_update_unlocked$q$, $q$UPDATE$q$, $q$authenticated$q$, $q$(app.is_admin_or_trainer() AND (locked = false))$q$, $q$app.is_admin_or_trainer()$q$),
      ($q$assessments$q$, $q$assessments_delete$q$, $q$DELETE$q$, $q$authenticated$q$, $q$app.is_admin()$q$, null),
      ($q$participant_skill_results$q$, $q$participant_skill_results_insert$q$, $q$INSERT$q$, $q$authenticated$q$, null, $q$app.is_admin_or_trainer()$q$),
      ($q$participant_skill_results$q$, $q$participant_skill_results_update$q$, $q$UPDATE$q$, $q$authenticated$q$, $q$app.is_admin_or_trainer()$q$, $q$app.is_admin_or_trainer()$q$),
      ($q$participant_skill_results$q$, $q$participant_skill_results_delete$q$, $q$DELETE$q$, $q$authenticated$q$, $q$app.is_admin()$q$, null),
      ($q$certificate_templates$q$, $q$cert_templates_admin_write$q$, $q$ALL$q$, $q$public$q$, $q$app.is_admin()$q$, $q$app.is_admin()$q$),
      ($q$course_commercial_profiles$q$, $q$course_commercial_profiles_insert$q$, $q$INSERT$q$, $q$authenticated$q$, null, $q$app.is_admin()$q$),
      ($q$course_commercial_profiles$q$, $q$course_commercial_profiles_update$q$, $q$UPDATE$q$, $q$authenticated$q$, $q$app.is_admin()$q$, $q$app.is_admin()$q$),
      ($q$course_commercial_profiles$q$, $q$course_commercial_profiles_delete$q$, $q$DELETE$q$, $q$authenticated$q$, $q$app.is_admin()$q$, null),
      ($q$legacy_course_map$q$, $q$legacy_course_map_insert$q$, $q$INSERT$q$, $q$public$q$, null, $q$app.is_admin()$q$),
      ($q$legacy_course_map$q$, $q$legacy_course_map_update$q$, $q$UPDATE$q$, $q$public$q$, $q$app.is_admin()$q$, $q$app.is_admin()$q$),
      ($q$legacy_course_map$q$, $q$legacy_course_map_delete$q$, $q$DELETE$q$, $q$public$q$, $q$app.is_admin()$q$, null),
      ($q$legacy_import_batches$q$, $q$legacy_import_batches_insert$q$, $q$INSERT$q$, $q$public$q$, null, $q$app.is_admin()$q$),
      ($q$legacy_import_batches$q$, $q$legacy_import_batches_update$q$, $q$UPDATE$q$, $q$public$q$, $q$app.is_admin()$q$, $q$app.is_admin()$q$),
      ($q$legacy_import_batches$q$, $q$legacy_import_batches_delete$q$, $q$DELETE$q$, $q$public$q$, $q$app.is_admin()$q$, null),
      ($q$legacy_participant_staging$q$, $q$legacy_participant_staging_insert$q$, $q$INSERT$q$, $q$public$q$, null, $q$app.is_admin()$q$),
      ($q$legacy_participant_staging$q$, $q$legacy_participant_staging_update$q$, $q$UPDATE$q$, $q$public$q$, $q$app.is_admin()$q$, $q$app.is_admin()$q$),
      ($q$legacy_participant_staging$q$, $q$legacy_participant_staging_delete$q$, $q$DELETE$q$, $q$public$q$, $q$app.is_admin()$q$, null),
      ($q$certificate_import_logs$q$, $q$Admins can create import logs$q$, $q$INSERT$q$, $q$authenticated$q$, null, $q$((created_by = auth.uid()) AND app.is_admin())$q$),
      ($q$courses$q$, $q$courses_delete$q$, $q$DELETE$q$, $q$authenticated$q$, $q$app.is_admin()$q$, null),
      ($q$news_posts$q$, $q$news_posts_admin_delete$q$, $q$DELETE$q$, $q$public$q$, $q$app.is_admin()$q$, null),
      ($q$faqs$q$, $q$faqs_admin_delete$q$, $q$DELETE$q$, $q$public$q$, $q$app.is_admin()$q$, null),
      ($q$downloads$q$, $q$downloads_admin_delete$q$, $q$DELETE$q$, $q$public$q$, $q$app.is_admin()$q$, null),
      ($q$gallery_images$q$, $q$gallery_images_admin_delete$q$, $q$DELETE$q$, $q$public$q$, $q$app.is_admin()$q$, null),
      ($q$media$q$, $q$media_admin_delete$q$, $q$DELETE$q$, $q$public$q$, $q$app.is_admin()$q$, null)
    ) as t(tbl, pol, cmd, roles, qual, chk)
  loop
    if not exists (select 1 from pg_policies p
                   where p.schemaname = 'public' and p.tablename = r.tbl and p.policyname = r.pol and p.cmd = r.cmd
                     and array_to_string(p.roles, ',') = r.roles and p.permissive = 'PERMISSIVE'
                     and p.qual is not distinct from r.qual and p.with_check is not distinct from r.chk) then
      raise exception 'm09_precondition_failed: policy %.% is not the reviewed pre-state - nothing changed', r.tbl, r.pol using errcode = 'P0001';
    end if;
  end loop;
end;
$m09_pre$;

drop policy if exists participants_insert on public.participants;
create policy participants_insert on public.participants as permissive for insert to authenticated
  with check ((app.is_admin() AND ( SELECT public.has_module_access_level('participants'::text, 'edit'::text) AS has_module_access_level)));

drop policy if exists participants_update on public.participants;
create policy participants_update on public.participants as permissive for update to authenticated
  using ((app.is_admin() AND ( SELECT public.has_module_access_level('participants'::text, 'edit'::text) AS has_module_access_level)))
  with check ((app.is_admin() AND ( SELECT public.has_module_access_level('participants'::text, 'edit'::text) AS has_module_access_level)));

drop policy if exists participants_delete on public.participants;
create policy participants_delete on public.participants as permissive for delete to authenticated
  using ((app.is_admin() AND ( SELECT public.has_module_access_level('participants'::text, 'admin'::text) AS has_module_access_level)));

drop policy if exists schedule_participants_insert on public.schedule_participants;
create policy schedule_participants_insert on public.schedule_participants as permissive for insert to authenticated
  with check ((app.is_admin() AND ( SELECT public.has_module_access_level('schedules'::text, 'edit'::text) AS has_module_access_level)));

drop policy if exists schedule_participants_update on public.schedule_participants;
create policy schedule_participants_update on public.schedule_participants as permissive for update to authenticated
  using ((app.is_admin() AND ( SELECT public.has_module_access_level('schedules'::text, 'edit'::text) AS has_module_access_level)))
  with check ((app.is_admin() AND ( SELECT public.has_module_access_level('schedules'::text, 'edit'::text) AS has_module_access_level)));

drop policy if exists schedule_participants_delete on public.schedule_participants;
create policy schedule_participants_delete on public.schedule_participants as permissive for delete to authenticated
  using ((app.is_admin() AND ( SELECT public.has_module_access_level('schedules'::text, 'admin'::text) AS has_module_access_level)));

drop policy if exists course_schedules_insert on public.course_schedules;
create policy course_schedules_insert on public.course_schedules as permissive for insert to authenticated
  with check ((app.is_admin() AND ( SELECT public.has_module_access_level('schedules'::text, 'edit'::text) AS has_module_access_level)));

drop policy if exists course_schedules_update on public.course_schedules;
create policy course_schedules_update on public.course_schedules as permissive for update to authenticated
  using ((app.is_admin() AND ( SELECT public.has_module_access_level('schedules'::text, 'edit'::text) AS has_module_access_level)))
  with check ((app.is_admin() AND ( SELECT public.has_module_access_level('schedules'::text, 'edit'::text) AS has_module_access_level)));

drop policy if exists course_schedules_delete on public.course_schedules;
create policy course_schedules_delete on public.course_schedules as permissive for delete to authenticated
  using ((app.is_admin() AND ( SELECT public.has_module_access_level('schedules'::text, 'admin'::text) AS has_module_access_level)));

drop policy if exists attendance_insert on public.attendance;
create policy attendance_insert on public.attendance as permissive for insert to authenticated
  with check (((app.is_admin() AND ( SELECT public.has_module_access_level('attendance'::text, 'edit'::text) AS has_module_access_level)) OR (app.is_admin_or_trainer() AND (NOT app.is_admin()))));

drop policy if exists attendance_update on public.attendance;
create policy attendance_update on public.attendance as permissive for update to authenticated
  using (((app.is_admin() AND ( SELECT public.has_module_access_level('attendance'::text, 'edit'::text) AS has_module_access_level)) OR (app.is_admin_or_trainer() AND (NOT app.is_admin()))))
  with check (((app.is_admin() AND ( SELECT public.has_module_access_level('attendance'::text, 'edit'::text) AS has_module_access_level)) OR (app.is_admin_or_trainer() AND (NOT app.is_admin()))));

drop policy if exists attendance_delete on public.attendance;
create policy attendance_delete on public.attendance as permissive for delete to authenticated
  using (((app.is_admin() AND ( SELECT public.has_module_access_level('attendance'::text, 'edit'::text) AS has_module_access_level)) OR (app.is_admin_or_trainer() AND (NOT app.is_admin()))));

drop policy if exists assessments_insert on public.assessments;
create policy assessments_insert on public.assessments as permissive for insert to authenticated
  with check (((app.is_admin() AND ( SELECT public.has_module_access_level('assessment'::text, 'edit'::text) AS has_module_access_level)) OR (app.is_admin_or_trainer() AND (NOT app.is_admin()))));

drop policy if exists assessments_update_unlocked on public.assessments;
create policy assessments_update_unlocked on public.assessments as permissive for update to authenticated
  using ((((app.is_admin() AND ( SELECT public.has_module_access_level('assessment'::text, 'edit'::text) AS has_module_access_level)) OR (app.is_admin_or_trainer() AND (NOT app.is_admin()))) AND (locked = false)))
  with check (((app.is_admin() AND ( SELECT public.has_module_access_level('assessment'::text, 'edit'::text) AS has_module_access_level)) OR (app.is_admin_or_trainer() AND (NOT app.is_admin()))));

drop policy if exists assessments_delete on public.assessments;
create policy assessments_delete on public.assessments as permissive for delete to authenticated
  using ((app.is_admin() AND ( SELECT public.has_module_access_level('assessment'::text, 'admin'::text) AS has_module_access_level)));

drop policy if exists participant_skill_results_insert on public.participant_skill_results;
create policy participant_skill_results_insert on public.participant_skill_results as permissive for insert to authenticated
  with check (((app.is_admin() AND ( SELECT public.has_module_access_level('assessment'::text, 'edit'::text) AS has_module_access_level)) OR (app.is_admin_or_trainer() AND (NOT app.is_admin()))));

drop policy if exists participant_skill_results_update on public.participant_skill_results;
create policy participant_skill_results_update on public.participant_skill_results as permissive for update to authenticated
  using (((app.is_admin() AND ( SELECT public.has_module_access_level('assessment'::text, 'edit'::text) AS has_module_access_level)) OR (app.is_admin_or_trainer() AND (NOT app.is_admin()))))
  with check (((app.is_admin() AND ( SELECT public.has_module_access_level('assessment'::text, 'edit'::text) AS has_module_access_level)) OR (app.is_admin_or_trainer() AND (NOT app.is_admin()))));

drop policy if exists participant_skill_results_delete on public.participant_skill_results;
create policy participant_skill_results_delete on public.participant_skill_results as permissive for delete to authenticated
  using ((app.is_admin() AND ( SELECT public.has_module_access_level('assessment'::text, 'admin'::text) AS has_module_access_level)));

drop policy if exists cert_templates_admin_write on public.certificate_templates;
create policy cert_templates_admin_write on public.certificate_templates as permissive for all to public
  using ((app.is_admin() AND ( SELECT app.has_any_module_access(ARRAY['certificate_templates'::text, 'certificates'::text], 'edit'::text) AS has_any_module_access)))
  with check ((app.is_admin() AND ( SELECT app.has_any_module_access(ARRAY['certificate_templates'::text, 'certificates'::text], 'edit'::text) AS has_any_module_access)));

drop policy if exists course_commercial_profiles_insert on public.course_commercial_profiles;
create policy course_commercial_profiles_insert on public.course_commercial_profiles as permissive for insert to authenticated
  with check ((app.is_admin() AND ( SELECT public.has_module_access_level('courses'::text, 'edit'::text) AS has_module_access_level)));

drop policy if exists course_commercial_profiles_update on public.course_commercial_profiles;
create policy course_commercial_profiles_update on public.course_commercial_profiles as permissive for update to authenticated
  using ((app.is_admin() AND ( SELECT public.has_module_access_level('courses'::text, 'edit'::text) AS has_module_access_level)))
  with check ((app.is_admin() AND ( SELECT public.has_module_access_level('courses'::text, 'edit'::text) AS has_module_access_level)));

drop policy if exists course_commercial_profiles_delete on public.course_commercial_profiles;
create policy course_commercial_profiles_delete on public.course_commercial_profiles as permissive for delete to authenticated
  using ((app.is_admin() AND ( SELECT public.has_module_access_level('courses'::text, 'admin'::text) AS has_module_access_level)));

drop policy if exists legacy_course_map_insert on public.legacy_course_map;
create policy legacy_course_map_insert on public.legacy_course_map as permissive for insert to public
  with check ((app.is_admin() AND ( SELECT public.has_module_access_level('legacy_import'::text, 'admin'::text) AS has_module_access_level)));

drop policy if exists legacy_course_map_update on public.legacy_course_map;
create policy legacy_course_map_update on public.legacy_course_map as permissive for update to public
  using ((app.is_admin() AND ( SELECT public.has_module_access_level('legacy_import'::text, 'admin'::text) AS has_module_access_level)))
  with check ((app.is_admin() AND ( SELECT public.has_module_access_level('legacy_import'::text, 'admin'::text) AS has_module_access_level)));

drop policy if exists legacy_course_map_delete on public.legacy_course_map;
create policy legacy_course_map_delete on public.legacy_course_map as permissive for delete to public
  using ((app.is_admin() AND ( SELECT public.has_module_access_level('legacy_import'::text, 'admin'::text) AS has_module_access_level)));

drop policy if exists legacy_import_batches_insert on public.legacy_import_batches;
create policy legacy_import_batches_insert on public.legacy_import_batches as permissive for insert to public
  with check ((app.is_admin() AND ( SELECT public.has_module_access_level('legacy_import'::text, 'admin'::text) AS has_module_access_level)));

drop policy if exists legacy_import_batches_update on public.legacy_import_batches;
create policy legacy_import_batches_update on public.legacy_import_batches as permissive for update to public
  using ((app.is_admin() AND ( SELECT public.has_module_access_level('legacy_import'::text, 'admin'::text) AS has_module_access_level)))
  with check ((app.is_admin() AND ( SELECT public.has_module_access_level('legacy_import'::text, 'admin'::text) AS has_module_access_level)));

drop policy if exists legacy_import_batches_delete on public.legacy_import_batches;
create policy legacy_import_batches_delete on public.legacy_import_batches as permissive for delete to public
  using ((app.is_admin() AND ( SELECT public.has_module_access_level('legacy_import'::text, 'admin'::text) AS has_module_access_level)));

drop policy if exists legacy_participant_staging_insert on public.legacy_participant_staging;
create policy legacy_participant_staging_insert on public.legacy_participant_staging as permissive for insert to public
  with check ((app.is_admin() AND ( SELECT public.has_module_access_level('legacy_import'::text, 'admin'::text) AS has_module_access_level)));

drop policy if exists legacy_participant_staging_update on public.legacy_participant_staging;
create policy legacy_participant_staging_update on public.legacy_participant_staging as permissive for update to public
  using ((app.is_admin() AND ( SELECT public.has_module_access_level('legacy_import'::text, 'admin'::text) AS has_module_access_level)))
  with check ((app.is_admin() AND ( SELECT public.has_module_access_level('legacy_import'::text, 'admin'::text) AS has_module_access_level)));

drop policy if exists legacy_participant_staging_delete on public.legacy_participant_staging;
create policy legacy_participant_staging_delete on public.legacy_participant_staging as permissive for delete to public
  using ((app.is_admin() AND ( SELECT public.has_module_access_level('legacy_import'::text, 'admin'::text) AS has_module_access_level)));

drop policy if exists "Admins can create import logs" on public.certificate_import_logs;
create policy "Admins can create import logs" on public.certificate_import_logs as permissive for insert to authenticated
  with check (((created_by = auth.uid()) AND app.is_admin() AND ( SELECT public.has_module_access_level('certificates'::text, 'edit'::text) AS has_module_access_level)));

drop policy if exists courses_delete on public.courses;
create policy courses_delete on public.courses as permissive for delete to authenticated
  using ((app.is_admin() AND ( SELECT public.has_module_access_level('courses'::text, 'admin'::text) AS has_module_access_level)));

drop policy if exists news_posts_admin_delete on public.news_posts;
create policy news_posts_admin_delete on public.news_posts as permissive for delete to public
  using ((app.is_admin() AND ( SELECT public.has_module_access_level('news'::text, 'admin'::text) AS has_module_access_level)));

drop policy if exists faqs_admin_delete on public.faqs;
create policy faqs_admin_delete on public.faqs as permissive for delete to public
  using ((app.is_admin() AND ( SELECT public.has_module_access_level('faq'::text, 'admin'::text) AS has_module_access_level)));

drop policy if exists downloads_admin_delete on public.downloads;
create policy downloads_admin_delete on public.downloads as permissive for delete to public
  using ((app.is_admin() AND ( SELECT public.has_module_access_level('downloads'::text, 'admin'::text) AS has_module_access_level)));

drop policy if exists gallery_images_admin_delete on public.gallery_images;
create policy gallery_images_admin_delete on public.gallery_images as permissive for delete to public
  using ((app.is_admin() AND ( SELECT public.has_module_access_level('gallery'::text, 'admin'::text) AS has_module_access_level)));

drop policy if exists media_admin_delete on public.media;
create policy media_admin_delete on public.media as permissive for delete to public
  using ((app.is_admin() AND ( SELECT public.has_module_access_level('media'::text, 'admin'::text) AS has_module_access_level)));

-- Legacy-import RPC gates: exactly one line per body; pinned hash, single occurrence, ACL compared.
do $m09_rpc_gates$
declare
  r record; v_src text; v_def text; v_acl text; v_n int; v_expect text;
begin
  for r in
    select * from (values
      ($q$public.legacy_course_map_approve(uuid,uuid,uuid)$q$, $q$141f808e179c1f7172c31d32e865ede0$q$, $q$if not app.is_admin() then$q$, $q$if not (app.is_admin() and public.has_module_access_level('legacy_import', 'admin')) then$q$),
      ($q$public.legacy_import_create_batch(text,text,text)$q$, $q$242bddd5ae43bbf63ddd5be40cc0db9b$q$, $q$if not app.is_admin() then$q$, $q$if not (app.is_admin() and public.has_module_access_level('legacy_import', 'admin')) then$q$),
      ($q$public.legacy_import_ingest_rows(uuid,jsonb)$q$, $q$54e88a7384bbeb2c5eeaba02a6c7884a$q$, $q$if not app.is_admin() then$q$, $q$if not (app.is_admin() and public.has_module_access_level('legacy_import', 'admin')) then$q$),
      ($q$public.legacy_merge_dry_run(uuid)$q$, $q$b5dc900debaef942de4d1c2f48e31117$q$, $q$if not app.is_admin() then$q$, $q$if not (app.is_admin() and public.has_module_access_level('legacy_import', 'admin')) then$q$),
      ($q$public.legacy_merge_execute_row(uuid,uuid)$q$, $q$06f3cfce99ff78ff362b61c5e98b71d3$q$, $q$if not app.is_admin() then$q$, $q$if not (app.is_admin() and public.has_module_access_level('legacy_import', 'admin')) then$q$),
      ($q$public.legacy_merge_finalize_batch(uuid)$q$, $q$13946fd156b19dae085f315e95d467bc$q$, $q$if not app.is_admin() then$q$, $q$if not (app.is_admin() and public.has_module_access_level('legacy_import', 'admin')) then$q$),
      ($q$public.legacy_merge_verify_checkpoint(uuid)$q$, $q$e32d475d4b6d42f683a363b95a789d90$q$, $q$if not app.is_admin() then$q$, $q$if not (app.is_admin() and public.has_module_access_level('legacy_import', 'admin')) then$q$)
    ) as t(sig, body_md5, old_line, new_line)
  loop
    select prosrc, coalesce(proacl::text, '') into v_src, v_acl from pg_proc where oid = to_regprocedure(r.sig);
    if v_src is null then
      raise exception 'm09_rpc_precondition_failed: % does not exist - nothing changed', r.sig using errcode = 'P0001';
    end if;
    if md5(replace(v_src, chr(13), '')) <> r.body_md5 then
      raise exception 'm09_rpc_precondition_failed: % body is not the reviewed pre-state - nothing changed', r.sig using errcode = 'P0001';
    end if;
    v_n := (length(v_src) - length(replace(v_src, r.old_line, ''))) / length(r.old_line);
    if v_n <> 1 then
      raise exception 'm09_rpc_precondition_failed: % has % occurrence(s) of the gate line, expected 1', r.sig, v_n using errcode = 'P0001';
    end if;
    v_expect := md5(replace(v_src, r.old_line, r.new_line));
    v_def := replace(pg_get_functiondef(to_regprocedure(r.sig)), r.old_line, r.new_line);
    execute v_def;
    if (select md5(prosrc) from pg_proc where oid = to_regprocedure(r.sig)) <> v_expect
       or (select coalesce(proacl::text, '') from pg_proc where oid = to_regprocedure(r.sig)) <> v_acl then
      raise exception 'm09_rpc_postcondition_failed: % changed beyond the gate line or its ACL changed', r.sig using errcode = 'P0001';
    end if;
  end loop;
end;
$m09_rpc_gates$;

do $m09_post$
declare r record;
begin
  for r in
    select * from (values
      ($q$participants$q$, $q$participants_insert$q$, $q$INSERT$q$, $q$authenticated$q$, $q$'participants'::text, 'edit'$q$),
      ($q$participants$q$, $q$participants_update$q$, $q$UPDATE$q$, $q$authenticated$q$, $q$'participants'::text, 'edit'$q$),
      ($q$participants$q$, $q$participants_delete$q$, $q$DELETE$q$, $q$authenticated$q$, $q$'participants'::text, 'admin'$q$),
      ($q$schedule_participants$q$, $q$schedule_participants_insert$q$, $q$INSERT$q$, $q$authenticated$q$, $q$'schedules'::text, 'edit'$q$),
      ($q$schedule_participants$q$, $q$schedule_participants_update$q$, $q$UPDATE$q$, $q$authenticated$q$, $q$'schedules'::text, 'edit'$q$),
      ($q$schedule_participants$q$, $q$schedule_participants_delete$q$, $q$DELETE$q$, $q$authenticated$q$, $q$'schedules'::text, 'admin'$q$),
      ($q$course_schedules$q$, $q$course_schedules_insert$q$, $q$INSERT$q$, $q$authenticated$q$, $q$'schedules'::text, 'edit'$q$),
      ($q$course_schedules$q$, $q$course_schedules_update$q$, $q$UPDATE$q$, $q$authenticated$q$, $q$'schedules'::text, 'edit'$q$),
      ($q$course_schedules$q$, $q$course_schedules_delete$q$, $q$DELETE$q$, $q$authenticated$q$, $q$'schedules'::text, 'admin'$q$),
      ($q$attendance$q$, $q$attendance_insert$q$, $q$INSERT$q$, $q$authenticated$q$, $q$'attendance'::text, 'edit'$q$),
      ($q$attendance$q$, $q$attendance_update$q$, $q$UPDATE$q$, $q$authenticated$q$, $q$'attendance'::text, 'edit'$q$),
      ($q$attendance$q$, $q$attendance_delete$q$, $q$DELETE$q$, $q$authenticated$q$, $q$'attendance'::text, 'edit'$q$),
      ($q$assessments$q$, $q$assessments_insert$q$, $q$INSERT$q$, $q$authenticated$q$, $q$'assessment'::text, 'edit'$q$),
      ($q$assessments$q$, $q$assessments_update_unlocked$q$, $q$UPDATE$q$, $q$authenticated$q$, $q$'assessment'::text, 'edit'$q$),
      ($q$assessments$q$, $q$assessments_delete$q$, $q$DELETE$q$, $q$authenticated$q$, $q$'assessment'::text, 'admin'$q$),
      ($q$participant_skill_results$q$, $q$participant_skill_results_insert$q$, $q$INSERT$q$, $q$authenticated$q$, $q$'assessment'::text, 'edit'$q$),
      ($q$participant_skill_results$q$, $q$participant_skill_results_update$q$, $q$UPDATE$q$, $q$authenticated$q$, $q$'assessment'::text, 'edit'$q$),
      ($q$participant_skill_results$q$, $q$participant_skill_results_delete$q$, $q$DELETE$q$, $q$authenticated$q$, $q$'assessment'::text, 'admin'$q$),
      ($q$certificate_templates$q$, $q$cert_templates_admin_write$q$, $q$ALL$q$, $q$public$q$, $q$'certificates'::text], 'edit'$q$),
      ($q$course_commercial_profiles$q$, $q$course_commercial_profiles_insert$q$, $q$INSERT$q$, $q$authenticated$q$, $q$'courses'::text, 'edit'$q$),
      ($q$course_commercial_profiles$q$, $q$course_commercial_profiles_update$q$, $q$UPDATE$q$, $q$authenticated$q$, $q$'courses'::text, 'edit'$q$),
      ($q$course_commercial_profiles$q$, $q$course_commercial_profiles_delete$q$, $q$DELETE$q$, $q$authenticated$q$, $q$'courses'::text, 'admin'$q$),
      ($q$legacy_course_map$q$, $q$legacy_course_map_insert$q$, $q$INSERT$q$, $q$public$q$, $q$'legacy_import'::text, 'admin'$q$),
      ($q$legacy_course_map$q$, $q$legacy_course_map_update$q$, $q$UPDATE$q$, $q$public$q$, $q$'legacy_import'::text, 'admin'$q$),
      ($q$legacy_course_map$q$, $q$legacy_course_map_delete$q$, $q$DELETE$q$, $q$public$q$, $q$'legacy_import'::text, 'admin'$q$),
      ($q$legacy_import_batches$q$, $q$legacy_import_batches_insert$q$, $q$INSERT$q$, $q$public$q$, $q$'legacy_import'::text, 'admin'$q$),
      ($q$legacy_import_batches$q$, $q$legacy_import_batches_update$q$, $q$UPDATE$q$, $q$public$q$, $q$'legacy_import'::text, 'admin'$q$),
      ($q$legacy_import_batches$q$, $q$legacy_import_batches_delete$q$, $q$DELETE$q$, $q$public$q$, $q$'legacy_import'::text, 'admin'$q$),
      ($q$legacy_participant_staging$q$, $q$legacy_participant_staging_insert$q$, $q$INSERT$q$, $q$public$q$, $q$'legacy_import'::text, 'admin'$q$),
      ($q$legacy_participant_staging$q$, $q$legacy_participant_staging_update$q$, $q$UPDATE$q$, $q$public$q$, $q$'legacy_import'::text, 'admin'$q$),
      ($q$legacy_participant_staging$q$, $q$legacy_participant_staging_delete$q$, $q$DELETE$q$, $q$public$q$, $q$'legacy_import'::text, 'admin'$q$),
      ($q$certificate_import_logs$q$, $q$Admins can create import logs$q$, $q$INSERT$q$, $q$authenticated$q$, $q$'certificates'::text, 'edit'$q$),
      ($q$courses$q$, $q$courses_delete$q$, $q$DELETE$q$, $q$authenticated$q$, $q$'courses'::text, 'admin'$q$),
      ($q$news_posts$q$, $q$news_posts_admin_delete$q$, $q$DELETE$q$, $q$public$q$, $q$'news'::text, 'admin'$q$),
      ($q$faqs$q$, $q$faqs_admin_delete$q$, $q$DELETE$q$, $q$public$q$, $q$'faq'::text, 'admin'$q$),
      ($q$downloads$q$, $q$downloads_admin_delete$q$, $q$DELETE$q$, $q$public$q$, $q$'downloads'::text, 'admin'$q$),
      ($q$gallery_images$q$, $q$gallery_images_admin_delete$q$, $q$DELETE$q$, $q$public$q$, $q$'gallery'::text, 'admin'$q$),
      ($q$media$q$, $q$media_admin_delete$q$, $q$DELETE$q$, $q$public$q$, $q$'media'::text, 'admin'$q$)
    ) as t(tbl, pol, cmd, roles, token)
  loop
    if not exists (select 1 from pg_policies p
                   where p.schemaname = 'public' and p.tablename = r.tbl and p.policyname = r.pol and p.cmd = r.cmd
                     and array_to_string(p.roles, ',') = r.roles
                     and position(r.token in coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')) > 0) then
      raise exception 'm09_postcondition_failed: policy %.% is not as intended', r.tbl, r.pol using errcode = 'P0001';
    end if;
  end loop;
end;
$m09_post$;
