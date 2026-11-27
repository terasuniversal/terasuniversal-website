-- ROLLBACK for 20261201151000_training_t1_identity_evidence.sql (local design artefact; separate Owner approval required to run anywhere).
-- Removes the T1-b triggers, functions, constraints, indexes and the three new nullable columns, and restores the
-- three C4 certificate functions changed by K2.
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

-- K2: drop the G9-1 identity guard and restore the three C4 certificate functions to their reviewed pre-K2 bodies
-- (md5 70e92cb2... issuer, 2bf2d4ae... WAH wrapper, 9412568e... restore); grants are kept by REPLACE.
drop trigger if exists trg_t1_participant_identity on public.participants;
drop function if exists app.t1_guard_participant_identity();
CREATE OR REPLACE FUNCTION app.issue_certificate_with_skill_snapshot(p_schedule_id uuid, p_participant_id uuid, p_certificate_number text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, verification_token text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions'
 SET "TimeZone" TO 'Asia/Kuala_Lumpur'
AS $function$
declare
  v_elig public.v_certificate_eligibility%rowtype;
  v_schedule public.course_schedules%rowtype;
  v_course public.courses%rowtype;
  v_participant public.participants%rowtype;
  v_branch public.certificate_branches%rowtype;
  v_cert_id uuid;
  v_token text;
  v_area text;
  v_status text;
  v_score numeric;
  v_notes text;
  v_src_id uuid;
  v_group_id uuid;
  v_group_name text;
  v_trainer_id uuid;
  v_trainer_name text;
  v_assessor_id uuid;
  v_assessor_name text;
  v_template_name text;
  v_template_config jsonb := '{}'::jsonb;
  v_signature_reference text;
  v_design_variant text;
begin
  if not app.is_active() or not app.is_admin() or not public.has_module_access_level('certificates', 'admin') then
    raise exception 'Not authorized to issue certificates.' using errcode = '42501';
  end if;

  select * into v_elig
  from public.v_certificate_eligibility
  where schedule_id = p_schedule_id and participant_id = p_participant_id;
  if not found or not v_elig.eligible then
    raise exception 'Not eligible: %', coalesce(v_elig.ineligibility_reason, 'no_eligibility_row') using errcode = 'P0001';
  end if;

  select cs.* into v_schedule from public.course_schedules cs where cs.id = p_schedule_id and cs.deleted_at is null for update;
  select co.* into v_course from public.courses co where co.id = v_schedule.course_id and co.deleted_at is null;
  select p.* into v_participant from public.participants p where p.id = p_participant_id;

  if v_schedule.branch_id is null then
    raise exception 'Certificate issuing branch is not configured.' using errcode = 'P0001';
  end if;
  select b.* into v_branch
  from public.certificate_branches b
  where b.id = v_schedule.branch_id and b.is_active;
  if not found then
    raise exception 'Certificate issuing branch is inactive or missing.' using errcode = 'P0001';
  end if;

  -- Effective trainer: active group assignment first, schedule free-text fallback.
  select sp.schedule_group_id, g.name, g.trainer_id, t.full_name
    into v_group_id, v_group_name, v_trainer_id, v_trainer_name
  from public.schedule_participants sp
  join public.schedule_groups g on g.id = sp.schedule_group_id
    and g.schedule_id = p_schedule_id and g.deleted_at is null
  left join public.trainers t on t.id = g.trainer_id
  where sp.schedule_id = p_schedule_id
    and sp.participant_id = p_participant_id
    and sp.deleted_at is null
  limit 1;
  if v_trainer_name is null then
    v_trainer_name := nullif(btrim(v_schedule.trainer_name), '');
    v_trainer_id := null;
  end if;
  if v_trainer_name is null then
    raise exception 'Effective trainer is not configured.' using errcode = 'P0001';
  end if;

  -- Effective assessor: group override, otherwise the schedule primary assessor.
  if v_group_id is not null then
    select g.assessor_id, a.full_name into v_assessor_id, v_assessor_name
    from public.schedule_groups g
    left join public.assessors a on a.id = g.assessor_id
    where g.id = v_group_id and g.assessor_id is not null;
  end if;
  if v_assessor_id is null then
    select sa.assessor_id, a.full_name into v_assessor_id, v_assessor_name
    from public.schedule_assessors sa
    join public.assessors a on a.id = sa.assessor_id
    where sa.schedule_id = p_schedule_id and sa.is_primary = true
    order by sa.assigned_at nulls last, sa.created_at
    limit 1;
  end if;

  -- Signature-URL fallback CASE preserved verbatim from Production's
  -- existing, currently-live function body -- including its
  -- 'working_at_height_certificate' branch. This is pre-existing, already-
  -- deployed code being carried forward unchanged, not new WAH dispatch
  -- logic: this migration creates no WAH course, template, or trigger
  -- branch, so this CASE arm can never actually be reached by anything
  -- this migration adds. Removing it would be an unrelated, unnecessary
  -- edit to code this migration isn't meant to touch (Codex C4C-2D review
  -- finding #7, independently verified: this is the only Inspector/WAH-
  -- adjacent string anywhere in this file, and it's inert, inherited code,
  -- not an activation).
  select t.name, t.config, t.config->>'design_variant',
    coalesce(t.config->>'signature_url',
      case t.config->>'design_variant'
        when 'standard_scaffold_certificate' then '/signatures/director-signature-v2.png'
        when 'professional_scaffold_erection_skills' then '/signatures/director-signature.png'
        when 'working_at_height_certificate' then '/signatures/director-signature.png'
        else null
      end)
  into v_template_name, v_template_config, v_design_variant, v_signature_reference
  from public.certificate_templates t
  where t.id = v_elig.certificate_template_id
    and t.is_active and t.deleted_at is null;
  if not found or v_template_name is null then
    raise exception 'Certificate template resolution is not deterministic.' using errcode = 'P0001';
  end if;

  -- C4 Wave1 Erector safety guard, scoped to exactly the 3 real Erector
  -- course IDs -- new in this migration. No Inspector/WAH course ID
  -- appears here.
  if v_elig.course_id in (
    '2a78decf-6997-4626-a7cc-a1a23a110cf8'::uuid,
    '904293c4-8792-41d7-8744-42143887e577'::uuid,
    'b9c737b8-8a97-4c91-91ee-c65dc5982ca7'::uuid
  ) then
    if v_template_config->>'design_variant' is distinct from 'standard_scaffold_certificate' then
      raise exception 'C4_WAVE1_DESIGN_VARIANT_INVALID' using errcode = 'P0001';
    end if;
  end if;

  insert into public.certificates (
    participant_id, schedule_id, course_id, template_id,
    certificate_number, holder_name, participant_name, participant_code_snapshot, company_snapshot,
    identity_no, identity_last4,
    course_name, course_code, schedule_code, exam_date,
    training_start_date, training_end_date, venue, trainer_name,
    branch_id, branch_code, branch_name, branch_address,
    effective_assessor_name, status, issue_date, issued_by
  ) values (
    p_participant_id, p_schedule_id, v_elig.course_id, v_elig.certificate_template_id,
    p_certificate_number, v_elig.holder_name, v_elig.holder_name, coalesce(v_participant.participant_id, v_participant.participant_code), v_participant.company,
    nullif(btrim(v_participant.ic_passport_no), ''),
    case
      when length(regexp_replace(v_participant.ic_passport_no, '[^0-9A-Za-z]', '', 'g')) >= 4
        then upper(right(regexp_replace(v_participant.ic_passport_no, '[^0-9A-Za-z]', '', 'g'), 4))
      else null
    end,
    v_elig.course_name, v_course.course_code, v_schedule.schedule_code, v_schedule.exam_date,
    v_schedule.start_date, v_schedule.end_date, v_schedule.venue, v_trainer_name,
    v_branch.id, v_branch.branch_code, v_branch.branch_name, v_branch.display_address,
    v_assessor_name, 'valid', current_date, auth.uid()
  ) returning certificates.id, certificates.verification_token into v_cert_id, v_token;

  update public.certificates set verification_url = '/verify/' || v_token where certificates.id = v_cert_id;

  foreach v_area in array array['theory_session', 'practical_training', 'safety_awareness', 'practical_assessment'] loop
    select psr.status, psr.score, psr.notes, psr.id into v_status, v_score, v_notes, v_src_id
    from public.participant_skill_results psr
    where psr.schedule_id = p_schedule_id and psr.participant_id = p_participant_id
      and psr.area = v_area and psr.deleted_at is null;
    insert into public.certificate_skill_results (certificate_id, area, status, score, notes, source_skill_result_id)
    values (
      v_cert_id,
      v_area,
      case
        when v_area = 'practical_assessment' then case when v_status = 'passed' then 'passed' when v_status = 'failed' then 'failed' else 'not_recorded' end
        else case when v_status = 'completed' then 'completed' else 'not_recorded' end
      end,
      v_score, v_notes, v_src_id
    );
    v_status := null; v_score := null; v_notes := null; v_src_id := null;
  end loop;

  insert into public.certificate_skill_results (certificate_id, area, status)
  values (v_cert_id, 'attendance_requirement', case when v_elig.attendance_satisfied is null then 'not_recorded' when v_elig.attendance_satisfied then 'met' else 'not_met' end);

  insert into public.certificate_issuance_snapshots (
    certificate_id, snapshot_version, renderer_version, holder_name, identity_no, identity_last4,
    company_snapshot, participant_code_snapshot, course_name, course_code, schedule_code, training_start_date, training_end_date,
    exam_date, venue, branch_id, branch_code, branch_name, branch_address,
    trainer_name, effective_trainer_id, effective_assessor_id, effective_assessor_name,
    group_id, group_name, assessment_result, competency_status, issue_date,
    template_id, template_name, template_config, signature_reference,
    verification_metadata, render_payload, created_by
  )
  select v_cert_id, 2, 'certificate_renderer_v1', c.holder_name, c.identity_no, c.identity_last4,
    c.company_snapshot, c.participant_code_snapshot, c.course_name, c.course_code, c.schedule_code, c.training_start_date, c.training_end_date,
    c.exam_date, c.venue, c.branch_id, c.branch_code, c.branch_name, c.branch_address,
    c.trainer_name, v_trainer_id, v_assessor_id, v_assessor_name,
    v_group_id, v_group_name, v_elig.result, v_elig.competency_status, c.issue_date,
    c.template_id, v_template_name, coalesce(v_template_config, '{}'::jsonb), v_signature_reference,
    jsonb_build_object('certificate_number', c.certificate_number, 'verification_token', c.verification_token,
      'verification_path', c.verification_url, 'verification_enabled', c.verification_enabled,
      'public_verification_enabled', c.public_verification_enabled),
    jsonb_build_object('certificate_number', c.certificate_number, 'holder_name', c.holder_name,
      'identity_no', c.identity_no, 'participant_code_snapshot', c.participant_code_snapshot, 'company_snapshot', c.company_snapshot, 'course_name', c.course_name,
      'course_code', c.course_code, 'schedule_code', c.schedule_code, 'training_start_date', c.training_start_date,
      'training_end_date', c.training_end_date, 'exam_date', c.exam_date, 'venue', c.venue,
      'branch_code', c.branch_code, 'branch_name', c.branch_name, 'branch_address', c.branch_address,
      'trainer_name', c.trainer_name, 'effective_assessor_name', c.effective_assessor_name,
      'assessment_result', v_elig.result, 'competency_status', v_elig.competency_status,
      'issue_date', c.issue_date, 'skills_record', coalesce((select jsonb_agg(jsonb_build_object('area', s.area, 'status', s.status, 'score', s.score, 'notes', s.notes) order by s.area) from public.certificate_skill_results s where s.certificate_id = c.id), '[]'::jsonb)),
    auth.uid()
  from public.certificates c where c.id = v_cert_id;

  return query select v_cert_id, v_token;
end;
$function$;

CREATE OR REPLACE FUNCTION app.issue_wah_certificate_as_super_admin(p_schedule_id uuid, p_participant_id uuid, p_certificate_number text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, verification_token text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_is_super_admin boolean;
begin
  select (p.role::text = 'super_admin' and p.is_active) into v_is_super_admin
  from public.profiles p
  where p.id = v_uid;
  if v_uid is null or v_is_super_admin is not true then
    raise exception 'WAH_SUPER_ADMIN_REQUIRED: only the active Super Admin can issue Working at Height certificates.'
      using errcode = '42501';
  end if;

  perform app.authorize_wah_first_issuance(
    p_schedule_id, p_participant_id, 5, 'SUPER_ADMIN_CRM:' || v_uid::text);

  if app.wah_participant_holds_certificate(p_participant_id) then
    raise exception 'WAH_ALREADY_CERTIFIED: this participant already holds an active Working at Height certificate.'
      using errcode = 'P0001';
  end if;

  return query
    select s.id, s.verification_token
    from app.issue_certificate_with_skill_snapshot(p_schedule_id, p_participant_id, p_certificate_number) s;
end;
$function$;

CREATE OR REPLACE FUNCTION app.set_certificate_deleted(p_certificate_id uuid, p_deleted boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions'
AS $function$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null or not app.is_active() or not app.is_admin()
    or not public.has_module_access_level('certificates', 'admin') then
    raise exception 'Not authorized to change certificate deletion state.' using errcode = '42501';
  end if;
  perform 1 from public.certificates where id = p_certificate_id for update;
  if not found then
    raise exception 'Certificate not found.' using errcode = 'P0002';
  end if;
  update public.certificates
  set deleted_at = case when p_deleted then now() else null end
  where id = p_certificate_id;
end;
$function$;

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
