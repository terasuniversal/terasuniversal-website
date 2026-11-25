-- ROLLBACK for 20261201104000_rbac_m09_training_ops_write_narrowing.sql (local design artefact; separate Owner approval required to run anywhere).
-- Re-creates the previous policies verbatim (captured from the Production-equivalent fixture, 2026-11-24).
set local lock_timeout = '5s';
drop policy if exists participants_insert on public.participants;
create policy participants_insert on public.participants as permissive for insert to authenticated
  with check (app.is_admin());

drop policy if exists participants_update on public.participants;
create policy participants_update on public.participants as permissive for update to authenticated
  using (app.is_admin())
  with check (app.is_admin());

drop policy if exists participants_delete on public.participants;
create policy participants_delete on public.participants as permissive for delete to authenticated
  using (app.is_admin());

drop policy if exists schedule_participants_insert on public.schedule_participants;
create policy schedule_participants_insert on public.schedule_participants as permissive for insert to authenticated
  with check (app.is_admin());

drop policy if exists schedule_participants_update on public.schedule_participants;
create policy schedule_participants_update on public.schedule_participants as permissive for update to authenticated
  using (app.is_admin())
  with check (app.is_admin());

drop policy if exists schedule_participants_delete on public.schedule_participants;
create policy schedule_participants_delete on public.schedule_participants as permissive for delete to authenticated
  using (app.is_admin());

drop policy if exists course_schedules_insert on public.course_schedules;
create policy course_schedules_insert on public.course_schedules as permissive for insert to authenticated
  with check (app.is_admin());

drop policy if exists course_schedules_update on public.course_schedules;
create policy course_schedules_update on public.course_schedules as permissive for update to authenticated
  using (app.is_admin())
  with check (app.is_admin());

drop policy if exists course_schedules_delete on public.course_schedules;
create policy course_schedules_delete on public.course_schedules as permissive for delete to authenticated
  using (app.is_admin());

drop policy if exists attendance_insert on public.attendance;
create policy attendance_insert on public.attendance as permissive for insert to authenticated
  with check (app.is_admin_or_trainer());

drop policy if exists attendance_update on public.attendance;
create policy attendance_update on public.attendance as permissive for update to authenticated
  using (app.is_admin_or_trainer())
  with check (app.is_admin_or_trainer());

drop policy if exists attendance_delete on public.attendance;
create policy attendance_delete on public.attendance as permissive for delete to authenticated
  using (app.is_admin_or_trainer());

drop policy if exists assessments_insert on public.assessments;
create policy assessments_insert on public.assessments as permissive for insert to authenticated
  with check (app.is_admin_or_trainer());

drop policy if exists assessments_update_unlocked on public.assessments;
create policy assessments_update_unlocked on public.assessments as permissive for update to authenticated
  using ((app.is_admin_or_trainer() AND (locked = false)))
  with check (app.is_admin_or_trainer());

drop policy if exists assessments_delete on public.assessments;
create policy assessments_delete on public.assessments as permissive for delete to authenticated
  using (app.is_admin());

drop policy if exists participant_skill_results_insert on public.participant_skill_results;
create policy participant_skill_results_insert on public.participant_skill_results as permissive for insert to authenticated
  with check (app.is_admin_or_trainer());

drop policy if exists participant_skill_results_update on public.participant_skill_results;
create policy participant_skill_results_update on public.participant_skill_results as permissive for update to authenticated
  using (app.is_admin_or_trainer())
  with check (app.is_admin_or_trainer());

drop policy if exists participant_skill_results_delete on public.participant_skill_results;
create policy participant_skill_results_delete on public.participant_skill_results as permissive for delete to authenticated
  using (app.is_admin());

drop policy if exists cert_templates_admin_write on public.certificate_templates;
create policy cert_templates_admin_write on public.certificate_templates as permissive for all to public
  using (app.is_admin())
  with check (app.is_admin());

drop policy if exists course_commercial_profiles_insert on public.course_commercial_profiles;
create policy course_commercial_profiles_insert on public.course_commercial_profiles as permissive for insert to authenticated
  with check (app.is_admin());

drop policy if exists course_commercial_profiles_update on public.course_commercial_profiles;
create policy course_commercial_profiles_update on public.course_commercial_profiles as permissive for update to authenticated
  using (app.is_admin())
  with check (app.is_admin());

drop policy if exists course_commercial_profiles_delete on public.course_commercial_profiles;
create policy course_commercial_profiles_delete on public.course_commercial_profiles as permissive for delete to authenticated
  using (app.is_admin());

drop policy if exists legacy_course_map_insert on public.legacy_course_map;
create policy legacy_course_map_insert on public.legacy_course_map as permissive for insert to public
  with check (app.is_admin());

drop policy if exists legacy_course_map_update on public.legacy_course_map;
create policy legacy_course_map_update on public.legacy_course_map as permissive for update to public
  using (app.is_admin())
  with check (app.is_admin());

drop policy if exists legacy_course_map_delete on public.legacy_course_map;
create policy legacy_course_map_delete on public.legacy_course_map as permissive for delete to public
  using (app.is_admin());

drop policy if exists legacy_import_batches_insert on public.legacy_import_batches;
create policy legacy_import_batches_insert on public.legacy_import_batches as permissive for insert to public
  with check (app.is_admin());

drop policy if exists legacy_import_batches_update on public.legacy_import_batches;
create policy legacy_import_batches_update on public.legacy_import_batches as permissive for update to public
  using (app.is_admin())
  with check (app.is_admin());

drop policy if exists legacy_import_batches_delete on public.legacy_import_batches;
create policy legacy_import_batches_delete on public.legacy_import_batches as permissive for delete to public
  using (app.is_admin());

drop policy if exists legacy_participant_staging_insert on public.legacy_participant_staging;
create policy legacy_participant_staging_insert on public.legacy_participant_staging as permissive for insert to public
  with check (app.is_admin());

drop policy if exists legacy_participant_staging_update on public.legacy_participant_staging;
create policy legacy_participant_staging_update on public.legacy_participant_staging as permissive for update to public
  using (app.is_admin())
  with check (app.is_admin());

drop policy if exists legacy_participant_staging_delete on public.legacy_participant_staging;
create policy legacy_participant_staging_delete on public.legacy_participant_staging as permissive for delete to public
  using (app.is_admin());

drop policy if exists "Admins can create import logs" on public.certificate_import_logs;
create policy "Admins can create import logs" on public.certificate_import_logs as permissive for insert to authenticated
  with check (((created_by = auth.uid()) AND app.is_admin()));

drop policy if exists courses_delete on public.courses;
create policy courses_delete on public.courses as permissive for delete to authenticated
  using (app.is_admin());

drop policy if exists news_posts_admin_delete on public.news_posts;
create policy news_posts_admin_delete on public.news_posts as permissive for delete to public
  using (app.is_admin());

drop policy if exists faqs_admin_delete on public.faqs;
create policy faqs_admin_delete on public.faqs as permissive for delete to public
  using (app.is_admin());

drop policy if exists downloads_admin_delete on public.downloads;
create policy downloads_admin_delete on public.downloads as permissive for delete to public
  using (app.is_admin());

drop policy if exists gallery_images_admin_delete on public.gallery_images;
create policy gallery_images_admin_delete on public.gallery_images as permissive for delete to public
  using (app.is_admin());

drop policy if exists media_admin_delete on public.media;
create policy media_admin_delete on public.media as permissive for delete to public
  using (app.is_admin());

do $m09_rpc_rollback$
declare
  r record; v_src text; v_def text; v_acl text; v_n int; v_expect text;
begin
  for r in
    select * from (values
      ($q$public.legacy_course_map_approve(uuid,uuid,uuid)$q$, $q$141f808e179c1f7172c31d32e865ede0$q$, $q$if not (app.is_admin() and public.has_module_access_level('legacy_import', 'admin')) then$q$, $q$if not app.is_admin() then$q$),
      ($q$public.legacy_import_create_batch(text,text,text)$q$, $q$242bddd5ae43bbf63ddd5be40cc0db9b$q$, $q$if not (app.is_admin() and public.has_module_access_level('legacy_import', 'admin')) then$q$, $q$if not app.is_admin() then$q$),
      ($q$public.legacy_import_ingest_rows(uuid,jsonb)$q$, $q$54e88a7384bbeb2c5eeaba02a6c7884a$q$, $q$if not (app.is_admin() and public.has_module_access_level('legacy_import', 'admin')) then$q$, $q$if not app.is_admin() then$q$),
      ($q$public.legacy_merge_dry_run(uuid)$q$, $q$b5dc900debaef942de4d1c2f48e31117$q$, $q$if not (app.is_admin() and public.has_module_access_level('legacy_import', 'admin')) then$q$, $q$if not app.is_admin() then$q$),
      ($q$public.legacy_merge_execute_row(uuid,uuid)$q$, $q$06f3cfce99ff78ff362b61c5e98b71d3$q$, $q$if not (app.is_admin() and public.has_module_access_level('legacy_import', 'admin')) then$q$, $q$if not app.is_admin() then$q$),
      ($q$public.legacy_merge_finalize_batch(uuid)$q$, $q$13946fd156b19dae085f315e95d467bc$q$, $q$if not (app.is_admin() and public.has_module_access_level('legacy_import', 'admin')) then$q$, $q$if not app.is_admin() then$q$),
      ($q$public.legacy_merge_verify_checkpoint(uuid)$q$, $q$e32d475d4b6d42f683a363b95a789d90$q$, $q$if not (app.is_admin() and public.has_module_access_level('legacy_import', 'admin')) then$q$, $q$if not app.is_admin() then$q$)
    ) as t(sig, body_md5, old_line, new_line)
  loop
    select prosrc, coalesce(proacl::text, '') into v_src, v_acl from pg_proc where oid = to_regprocedure(r.sig);
    if v_src is null then
      raise exception 'm09_rpc_precondition_failed: % does not exist - nothing changed', r.sig using errcode = 'P0001';
    end if;
    if md5(replace(replace(v_src, chr(13), ''), r.old_line, r.new_line)) <> r.body_md5 then
      raise exception 'm09_rpc_precondition_failed: % body is not the reviewed post-state - nothing changed', r.sig using errcode = 'P0001';
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
$m09_rpc_rollback$;
