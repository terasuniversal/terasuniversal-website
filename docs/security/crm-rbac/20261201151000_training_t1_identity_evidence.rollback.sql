-- ROLLBACK for 20261201151000_training_t1_identity_evidence.sql (local design artefact; separate Owner approval required to run anywhere).
-- Removes the T1-b triggers, functions, constraints, indexes and the three new nullable columns.
-- DATA SAFETY: dropping the columns discards any trainer_id / evidence values recorded after T1-b. The guard below
-- refuses to run while such values exist unless the operator first exports them and sets, in the same session:
--   set local t1.rollback_backup_taken = 'yes';
-- Run 20261201150000_training_t1_access.rollback.sql only AFTER this file.
-- audit_logs rows written by T1-b (entity attendance_undo) are history and are kept.

do $t1b_rb_guard$
begin
  if coalesce(current_setting('t1.rollback_backup_taken', true), '') <> 'yes' and (
       exists (select 1 from public.course_schedules where trainer_id is not null)
    or exists (select 1 from public.assessments where evidence_assessor_id is not null or evidence_reference is not null)
    or exists (select 1 from public.participant_skill_results where evidence_assessor_id is not null or evidence_reference is not null)) then
    raise exception 't1b_rollback_refused: T1-b columns hold data; export them and set t1.rollback_backup_taken = yes' using errcode = 'P0001';
  end if;
end;
$t1b_rb_guard$;

set local lock_timeout = '5s';

drop trigger if exists trg_t1_attendance_finalised on public.attendance;
drop trigger if exists trg_t1_soft_delete_floor on public.course_schedules;
drop trigger if exists trg_t1_soft_delete_floor on public.schedule_participants;
drop trigger if exists trg_t1_soft_delete_floor on public.participants;
drop trigger if exists trg_t1_soft_delete_floor on public.trainers;
drop trigger if exists trg_t1_result_archive_floor on public.assessments;
drop trigger if exists trg_t1_result_archive_floor on public.participant_skill_results;
drop trigger if exists trg_t1_skill_result_accountability on public.participant_skill_results;
drop trigger if exists trg_t1_assessment_accountability on public.assessments;
drop trigger if exists trg_t1_guard_schedule_trainer on public.course_schedules;

drop function if exists app.t1_guard_attendance_finalised();
drop function if exists app.t1_participant_finalised(uuid, uuid);
-- Restore app.log_event to its reviewed pre-T1 body (md5 d1622882268761f00421605e26882ebd); grants are kept by REPLACE.
create or replace function app.log_event(p_action audit_action, p_entity_type text default null::text, p_entity_id text default null::text, p_summary text default null::text, p_metadata jsonb default '{}'::jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_email text;
begin
  select email into v_email from public.profiles where id = auth.uid();
  insert into public.audit_logs (actor_id, actor_email, action, entity_type, entity_id, summary, metadata)
  values (auth.uid(), v_email, p_action, p_entity_type, p_entity_id, p_summary, coalesce(p_metadata, '{}'::jsonb));
end;
$function$;
drop function if exists app.t1_guard_result_archive();
drop function if exists app.t1_guard_soft_delete();
drop function if exists app.t1_guard_skill_result_accountability();
drop function if exists app.t1_guard_assessment_accountability();
drop function if exists app.t1_assert_assessment_evidence(uuid, uuid, uuid, text);
drop function if exists app.t1_guard_schedule_trainer();

drop index if exists public.idx_participant_skill_results_evidence_assessor_id;
drop index if exists public.idx_assessments_evidence_assessor_id;
drop index if exists public.idx_course_schedules_trainer_id;

alter table public.participant_skill_results drop constraint if exists participant_skill_results_evidence_reference_len;
alter table public.assessments drop constraint if exists assessments_evidence_reference_len;
alter table public.participant_skill_results drop column if exists evidence_reference, drop column if exists evidence_assessor_id;
alter table public.assessments drop column if exists evidence_reference, drop column if exists evidence_assessor_id;
alter table public.course_schedules drop column if exists trainer_id;

comment on column public.assessments.assessor_id is null;
comment on column public.participant_skill_results.assessed_by is null;
