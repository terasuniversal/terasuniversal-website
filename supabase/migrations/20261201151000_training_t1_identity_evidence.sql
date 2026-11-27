-- Training T1-b: trainer identity, actual-assessor evidence, Super Admin finalisation, soft-delete floor.
-- Approval: OWNER-TRAINING-T1-20261125. LOCAL AND DOCKER ONLY until a separate GO.
-- Requires 20261201150000_training_t1_access.sql (Training Ops writes via app.can_module).
--
-- Why:
--  * course_schedules has only a free-text trainer_name, so a schedule cannot be tied to a real trainer record.
--    trainer_id (nullable FK) is added; trainer_name is kept as is. Nothing is backfilled or guessed.
--  * assessments.assessor_id and participant_skill_results.assessed_by hold the STAFF who keyed the result
--    (data-entry actor), not the qualified Assessor. They are NOT repurposed. New columns record the actual
--    Assessor (evidence_assessor_id -> public.assessors) and an evidence reference (assessment sheet / file no.).
--  * For every new or changed result written by a signed-in non-Super-Admin (Training Ops Staff, Admin, Trainer):
--    the actual Assessor must be active and assigned to the schedule (schedule_assessors) or to the participant's
--    group (schedule_groups), an evidence reference of 3-200 characters is required, and the data-entry actor is
--    forced to the authenticated user. Legacy rows are left untouched; the check runs only when content changes.
--    A Super Admin may still correct a legacy row without evidence, but any evidence a Super Admin gives is validated.
--  * Locking (finalising) an assessment or a skill result is Super Admin only. Evidence on a locked row is
--    immutable. Skill results cannot be changed while the participant's assessment is locked (non-Super-Admin).
--  * F2 (Owner-approved remediation): a finalised (locked) skill result can be unlocked or changed only by a Super
--    Admin; every other writer is refused on any UPDATE of a locked row (the WAH correction RPC keeps its marker).
--  * F1-a (Owner-approved remediation): Attendance Undo (DELETE, see 20261201150000) and every other attendance write
--    are refused for a finalised participant - locked assessment or a non-draft, non-revoked certificate on that
--    schedule - unless the writer is a Super Admin. Every attendance DELETE by a signed-in user also writes an
--    audit_logs row (entity attendance_undo) with the removed mark, in addition to the generic attendance audit row.
--  * r4 (Owner GO 27 Nov) - one finalisation rule for attendance, assessments and skill results:
--      D-A2: a participant is FINALISED when the assessment is locked OR a non-draft, non-revoked certificate exists for
--            that schedule; every write (insert, update, archive, restore) for a finalised participant by anyone but
--            a Super Admin is refused (Training Ops, Admin and the Trainer branch alike). The audited WAH correction
--            marker keeps its existing exemption.
--      D-A3: the schedule / participant of an assessment or skill result can never be changed (every role, including
--            Super Admin and server sessions); a result belongs to one participant and a new one is recorded instead.
--      D-A1 (guard part only): the finalisation check first takes FOR SHARE on the schedule row, so a write waits for a
--            certificate issuance that already holds FOR UPDATE on it and then sees the committed certificate.
--  * K2 (Owner GO D4, 27 Nov):
--      K2-a (D-A1 C4 part, RA2): the certificate issuer and the WAH wrapper now lock the schedule BEFORE reading
--            eligibility, so a Training write that started first finishes first and is seen (no stale issuance).
--      K2-b: restoring a soft-deleted certificate takes the issuance locks and is refused when another active
--            certificate exists for the participant in the same scope (schedule; course for schedule-less rows;
--            any active WAH certificate for the person, as the WAH issuance rule).
--      K2-c (G9-1): full_name, ic_passport_no, identity_no, identity_last4, date_of_birth and nationality can be
--            changed only by a Super Admin or a server session; every other signed-in writer is refused (42501).
--      C1-b: the Undo audit row is written directly (not through log_event) and app.log_event refuses the reserved
--            entity type attendance_undo, so no caller of log_event can forge one. Other log_event uses are unchanged.
--  * T1-a lets Training Ops Staff update schedules, enrolments, participants and trainers; soft delete / restore
--    (deleted_at) keeps its previous floor: the Admin role (app.is_admin()). Archiving an assessment or a skill
--    result (an indirect DELETE) needs the Admin role too; re-recording a previously archived skill area is allowed.
-- Not changed: scoring, thresholds, competency rules, the WAH guards and correction RPC (exempted by the same
-- transaction marker they already use), certificate eligibility rules and issuance output, /verify, the existing
-- integrity trigger.
-- Service-role / migration sessions (auth.uid() is null) are not affected, as with the existing guards.

do $t1b_requires$
begin
  if to_regprocedure('app.can_module(text,text)') is null
     or not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'assessors' and policyname = 'assessors_read'
                    and position('can_module' in qual) > 0) then
    raise exception 't1b_precondition_failed: 20261201150000_training_t1_access is not applied - nothing changed' using errcode = 'P0001';
  end if;
  if to_regprocedure('app.enforce_assessment_security_integrity()') is null or to_regprocedure('app.guard_wah_skill_result()') is null then
    raise exception 't1b_precondition_failed: assessment integrity / WAH guards missing - nothing changed' using errcode = 'P0001';
  end if;
  if (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('app.log_event(audit_action,text,text,text,jsonb)'))
     is distinct from 'd1622882268761f00421605e26882ebd' then
    raise exception 't1b_precondition_failed: app.log_event body is not the reviewed pre-state - nothing changed' using errcode = 'P0001';
  end if;
  -- K2: the three C4 functions replaced below must be the reviewed pre-state (Production 27 Nov = fixture).
  if (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('app.issue_certificate_with_skill_snapshot(uuid,uuid,text)'))
       is distinct from '70e92cb2f028c2c24dd7de1a02f8ce03'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('app.issue_wah_certificate_as_super_admin(uuid,uuid,text)'))
       is distinct from '2bf2d4ae74fe3cc601cf00b45ff1a487'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('app.set_certificate_deleted(uuid,boolean)'))
       is distinct from '9412568e7baf3663835cdf30003ceedb'
     or to_regprocedure('app.wah_participant_holds_certificate(uuid)') is null
     or to_regprocedure('app.is_wah_legacy_target(uuid,text)') is null then
    raise exception 't1b_precondition_failed: K2 certificate functions are not the reviewed pre-state - nothing changed' using errcode = 'P0001';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public'
               and ((table_name = 'course_schedules' and column_name = 'trainer_id')
                 or (table_name in ('assessments', 'participant_skill_results') and column_name in ('evidence_assessor_id', 'evidence_reference')))) then
    raise exception 't1b_precondition_failed: T1-b columns already exist - nothing changed' using errcode = 'P0001';
  end if;
end;
$t1b_requires$;

set local lock_timeout = '5s';

-- ---------------------------------------------------------------- columns (nullable, no backfill)
alter table public.course_schedules add column if not exists trainer_id uuid references public.trainers (id);
create index if not exists idx_course_schedules_trainer_id on public.course_schedules (trainer_id) where trainer_id is not null;
comment on column public.course_schedules.trainer_id is
  'T1: assigned trainer record. Nullable; trainer_name (free text) is kept for legacy and display. Not backfilled.';

alter table public.assessments add column if not exists evidence_assessor_id uuid references public.assessors (id);
alter table public.assessments add column if not exists evidence_reference text;
alter table public.assessments add constraint assessments_evidence_reference_len
  check (evidence_reference is null or char_length(evidence_reference) <= 200);
create index if not exists idx_assessments_evidence_assessor_id on public.assessments (evidence_assessor_id) where evidence_assessor_id is not null;
comment on column public.assessments.assessor_id is 'Data-entry staff (profiles). Not the qualified Assessor - see evidence_assessor_id.';
comment on column public.assessments.evidence_assessor_id is 'T1: actual qualified Assessor (public.assessors) who assessed the participant.';
comment on column public.assessments.evidence_reference is 'T1: evidence reference (assessment sheet / file number), 3-200 characters for new entries.';

alter table public.participant_skill_results add column if not exists evidence_assessor_id uuid references public.assessors (id);
alter table public.participant_skill_results add column if not exists evidence_reference text;
alter table public.participant_skill_results add constraint participant_skill_results_evidence_reference_len
  check (evidence_reference is null or char_length(evidence_reference) <= 200);
create index if not exists idx_participant_skill_results_evidence_assessor_id on public.participant_skill_results (evidence_assessor_id) where evidence_assessor_id is not null;
comment on column public.participant_skill_results.assessed_by is 'Data-entry staff (profiles). Not the qualified Assessor - see evidence_assessor_id.';
comment on column public.participant_skill_results.evidence_assessor_id is 'T1: actual qualified Assessor (public.assessors).';
comment on column public.participant_skill_results.evidence_reference is 'T1: evidence reference, 3-200 characters for new entries.';

-- ---------------------------------------------------------------- trainer assignment integrity
create or replace function app.t1_guard_schedule_trainer()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.trainer_id is not null and (tg_op = 'INSERT' or new.trainer_id is distinct from old.trainer_id) then
    if not exists (select 1 from public.trainers t where t.id = new.trainer_id and t.status = 'active' and t.deleted_at is null) then
      raise exception using errcode = '23514', message = 'Only an active trainer can be assigned to a schedule';
    end if;
  end if;
  return new;
end;
$function$;

create trigger trg_t1_guard_schedule_trainer before insert or update of trainer_id on public.course_schedules
  for each row execute function app.t1_guard_schedule_trainer();

-- ---------------------------------------------------------------- assessor evidence
create or replace function app.t1_assert_assessment_evidence(p_schedule_id uuid, p_participant_id uuid, p_assessor_id uuid, p_reference text)
returns void
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if p_assessor_id is null then
    raise exception using errcode = '23514', message = 'Select the Assessor who assessed this participant';
  end if;
  if p_reference is null or char_length(btrim(p_reference)) < 3 or char_length(p_reference) > 200 then
    raise exception using errcode = '23514', message = 'An evidence reference of 3 to 200 characters is required';
  end if;
  if not exists (select 1 from public.assessors a where a.id = p_assessor_id and a.is_active) then
    raise exception using errcode = '23514', message = 'The selected Assessor is not active';
  end if;
  if not exists (select 1 from public.schedule_assessors sa where sa.schedule_id = p_schedule_id and sa.assessor_id = p_assessor_id)
     and not exists (select 1 from public.schedule_groups g
                     join public.schedule_participants sp on sp.schedule_group_id = g.id
                     where g.schedule_id = p_schedule_id and g.assessor_id = p_assessor_id and g.deleted_at is null
                       and sp.schedule_id = p_schedule_id and sp.participant_id = p_participant_id and sp.deleted_at is null) then
    raise exception using errcode = '23514', message = 'The selected Assessor is not assigned to this schedule or group';
  end if;
end;
$function$;
revoke all on function app.t1_assert_assessment_evidence(uuid, uuid, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- r4: one finalisation rule (D-A2) with guard locking (D-A1)
create or replace function app.t1_participant_finalised(p_schedule_id uuid, p_participant_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
begin
  -- D-A1 (guard part): wait for an in-flight certificate issuance on this schedule (it holds FOR UPDATE on the row).
  perform 1 from public.course_schedules s where s.id = p_schedule_id for share;
  -- Wait for a concurrent finalisation (lock) of the participant's assessment, then read the committed state in a new
  -- statement (a WHERE on "locked" in the locking query would skip a row that is being locked right now).
  perform 1 from public.assessments a where a.schedule_id = p_schedule_id and a.participant_id = p_participant_id
    and a.deleted_at is null for share;
  return exists (select 1 from public.assessments a where a.schedule_id = p_schedule_id and a.participant_id = p_participant_id
                   and a.locked and a.deleted_at is null)
      or exists (select 1 from public.certificates c where c.schedule_id = p_schedule_id and c.participant_id = p_participant_id
                   and c.deleted_at is null and c.status not in ('draft', 'revoked'));
end;
$function$;
revoke all on function app.t1_participant_finalised(uuid, uuid) from public, anon, authenticated;

create or replace function app.t1_guard_assessment_accountability()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor uuid := auth.uid();
  v_super boolean;
  v_content_changed boolean;
begin
  -- D-A3: a result belongs to one schedule and participant for good (every role, server sessions included).
  if tg_op = 'UPDATE' and (new.schedule_id is distinct from old.schedule_id or new.participant_id is distinct from old.participant_id) then
    raise exception using errcode = '42501', message = 'The schedule or participant of an assessment cannot be changed; record a new result instead';
  end if;
  if tg_op = 'UPDATE' and old.locked
     and (new.evidence_assessor_id is distinct from old.evidence_assessor_id or new.evidence_reference is distinct from old.evidence_reference) then
    raise exception using errcode = '42501', message = 'Locked assessment evidence cannot be changed';
  end if;
  if v_actor is null then
    return new;
  end if;
  v_super := app.is_super_admin();
  -- No write access at all (same branches as the assessments write policies): leave the row to RLS, so a caller
  -- without access gets the RLS denial and learns nothing about Assessors or the evidence rule.
  if not v_super and not (app.can_module('assessment', 'edit') or (app.is_admin_or_trainer() and not app.is_admin())) then
    return new;
  end if;
  if not v_super and new.locked and (tg_op = 'INSERT' or not old.locked) then
    raise exception using errcode = '42501', message = 'Only a Super Admin can finalise (lock) an assessment';
  end if;
  -- D-A2: results of a finalised participant (locked assessment or issued certificate) are Super Admin only.
  if not v_super and app.t1_participant_finalised(new.schedule_id, new.participant_id) then
    raise exception using errcode = '42501',
      message = 'Results of a finalised participant (locked assessment or issued certificate) can only be changed by a Super Admin';
  end if;
  v_content_changed := tg_op = 'INSERT'
    or new.assessment_type is distinct from old.assessment_type or new.score is distinct from old.score
    or new.max_score is distinct from old.max_score or new.result is distinct from old.result
    or new.assessed_at is distinct from old.assessed_at or new.remarks is distinct from old.remarks
    or new.theory_score is distinct from old.theory_score or new.practical_score is distinct from old.practical_score
    or new.competency_status is distinct from old.competency_status or new.theory_result is distinct from old.theory_result
    or new.practical_result is distinct from old.practical_result
    or new.evidence_assessor_id is distinct from old.evidence_assessor_id or new.evidence_reference is distinct from old.evidence_reference;
  -- A Super Admin may still correct a legacy row without evidence; evidence that IS given is always validated.
  if v_content_changed and (not v_super or new.evidence_assessor_id is not null or new.evidence_reference is not null) then
    perform app.t1_assert_assessment_evidence(new.schedule_id, new.participant_id, new.evidence_assessor_id, new.evidence_reference);
  end if;
  if v_content_changed and not v_super then
    new.assessor_id := v_actor;
  end if;
  return new;
end;
$function$;

create trigger trg_t1_assessment_accountability before insert or update on public.assessments
  for each row execute function app.t1_guard_assessment_accountability();

create or replace function app.t1_guard_skill_result_accountability()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor uuid := auth.uid();
  v_super boolean;
  v_content_changed boolean;
begin
  -- D-A3: a skill result belongs to one schedule and participant for good (every role, server sessions included).
  if tg_op = 'UPDATE' and (new.schedule_id is distinct from old.schedule_id or new.participant_id is distinct from old.participant_id) then
    raise exception using errcode = '42501', message = 'The schedule or participant of a skill result cannot be changed; record a new result instead';
  end if;
  if tg_op = 'UPDATE' and old.locked
     and (new.evidence_assessor_id is distinct from old.evidence_assessor_id or new.evidence_reference is distinct from old.evidence_reference) then
    raise exception using errcode = '42501', message = 'Locked skill result evidence cannot be changed';
  end if;
  if v_actor is null then
    return new;
  end if;
  v_content_changed := tg_op = 'INSERT' or new.status is distinct from old.status or new.score is distinct from old.score
     or new.notes is distinct from old.notes or new.area is distinct from old.area or new.deleted_at is distinct from old.deleted_at
     or new.evidence_assessor_id is distinct from old.evidence_assessor_id or new.evidence_reference is distinct from old.evidence_reference;
  v_super := app.is_super_admin();
  if v_super then
    if v_content_changed and (new.evidence_assessor_id is not null or new.evidence_reference is not null) then
      perform app.t1_assert_assessment_evidence(new.schedule_id, new.participant_id, new.evidence_assessor_id, new.evidence_reference);
    end if;
    return new;
  end if;
  if not (app.can_module('assessment', 'edit') or (app.is_admin_or_trainer() and not app.is_admin())) then
    return new; -- no write access: RLS denies, nothing about the rule or Assessors is revealed
  end if;
  -- The audited WAH correction RPC marks its own single-row update; it already requires its own reason and evidence.
  if tg_op = 'UPDATE' and coalesce(current_setting('app.wah_failed_correction', true), '') = new.id::text || ':' || new.status then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.locked then
    raise exception using errcode = '42501', message = 'Only a Super Admin can unlock or change a finalised skill result';
  end if;
  if new.locked and (tg_op = 'INSERT' or not old.locked) then
    raise exception using errcode = '42501', message = 'Only a Super Admin can finalise (lock) a skill result';
  end if;
  -- D-A2 (replaces the plain "assessment locked" check): locked assessment OR issued certificate, with guard locking.
  if app.t1_participant_finalised(new.schedule_id, new.participant_id) then
    raise exception using errcode = '42501',
      message = 'Results of a finalised participant (locked assessment or issued certificate) can only be changed by a Super Admin';
  end if;
  if v_content_changed then
    perform app.t1_assert_assessment_evidence(new.schedule_id, new.participant_id, new.evidence_assessor_id, new.evidence_reference);
    new.assessed_by := v_actor;
  end if;
  return new;
end;
$function$;

create trigger trg_t1_skill_result_accountability before insert or update on public.participant_skill_results
  for each row execute function app.t1_guard_skill_result_accountability();

-- ---------------------------------------------------------------- F1-a: finalised attendance + Undo audit
create or replace function app.t1_guard_attendance_finalised()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor uuid := auth.uid();
  v_pair record;
begin
  if v_actor is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if not app.is_super_admin() then
    if not (app.can_module('attendance', 'edit') or (app.is_admin_or_trainer() and not app.is_admin())) then
      if tg_op = 'DELETE' then return old; end if;
      return new; -- no write access: RLS denies, nothing about finalisation is revealed
    end if;
    for v_pair in
      select x.schedule_id, x.participant_id from (
        select old.schedule_id, old.participant_id where tg_op in ('UPDATE', 'DELETE')
        union select new.schedule_id, new.participant_id where tg_op in ('INSERT', 'UPDATE')) x
    loop
      -- Shared rule with guard locking (schedule FOR SHARE, then the assessment rows FOR SHARE, then a fresh read).
      if app.t1_participant_finalised(v_pair.schedule_id, v_pair.participant_id) then
        raise exception using errcode = '42501',
          message = 'Attendance of a finalised participant (locked assessment or issued certificate) can only be changed by a Super Admin';
      end if;
    end loop;
  end if;
  if tg_op = 'DELETE' then
    -- C1-b: written directly (log_event refuses this reserved entity type), actor from the session, metadata built here.
    insert into public.audit_logs (actor_id, actor_email, action, entity_type, entity_id, summary, metadata)
    values (v_actor, (select p.email from public.profiles p where p.id = v_actor), 'delete'::audit_action, 'attendance_undo',
      old.id::text, 'Attendance Undo', jsonb_build_object('schedule_id', old.schedule_id, 'participant_id', old.participant_id, 'session_date', old.session_date,
                         'attendance_status', old.attendance_status, 'present', old.present, 'check_in_time', old.check_in_time,
                         'check_out_time', old.check_out_time, 'recorded_by', old.recorded_by, 'super_admin', app.is_super_admin()));
    return old;
  end if;
  return new;
end;
$function$;

create trigger trg_t1_attendance_finalised before insert or update or delete on public.attendance
  for each row execute function app.t1_guard_attendance_finalised();

-- ---------------------------------------------------------------- soft delete / restore keeps the Admin-role floor
create or replace function app.t1_guard_soft_delete()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.deleted_at is distinct from old.deleted_at and auth.uid() is not null and not app.is_admin() then
    raise exception using errcode = '42501', message = 'Only an Admin can archive or restore this record';
  end if;
  return new;
end;
$function$;

create trigger trg_t1_soft_delete_floor before update of deleted_at on public.course_schedules
  for each row execute function app.t1_guard_soft_delete();
create trigger trg_t1_soft_delete_floor before update of deleted_at on public.schedule_participants
  for each row execute function app.t1_guard_soft_delete();
create trigger trg_t1_soft_delete_floor before update of deleted_at on public.participants
  for each row execute function app.t1_guard_soft_delete();
create trigger trg_t1_soft_delete_floor before update of deleted_at on public.trainers
  for each row execute function app.t1_guard_soft_delete();

-- Archiving a result (deleted_at null -> set) removes it from attendance, assessment and certificate views, so it is a
-- DELETE path in effect. It keeps the Admin-role floor; re-recording (set -> null, the Skills Record upsert) is allowed.
create or replace function app.t1_guard_result_archive()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if old.deleted_at is null and new.deleted_at is not null and auth.uid() is not null and not app.is_admin() then
    raise exception using errcode = '42501', message = 'Only an Admin can archive an assessment result';
  end if;
  return new;
end;
$function$;

create trigger trg_t1_result_archive_floor before update of deleted_at on public.assessments
  for each row execute function app.t1_guard_result_archive();
create trigger trg_t1_result_archive_floor before update of deleted_at on public.participant_skill_results
  for each row execute function app.t1_guard_result_archive();

-- ---------------------------------------------------------------- C1-b: reserved audit entity (body otherwise unchanged)
create or replace function app.log_event(p_action audit_action, p_entity_type text default null::text, p_entity_id text default null::text,
                                         p_summary text default null::text, p_metadata jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_email text;
begin
  -- attendance_undo rows are written only by app.t1_guard_attendance_finalised (Training T1 r4, C1-b).
  if p_entity_type = 'attendance_undo' then
    raise exception using errcode = '42501', message = 'attendance_undo audit events are recorded by the database only';
  end if;
  select email into v_email from public.profiles where id = auth.uid();
  insert into public.audit_logs (actor_id, actor_email, action, entity_type, entity_id, summary, metadata)
  values (auth.uid(), v_email, p_action, p_entity_type, p_entity_id, p_summary, coalesce(p_metadata, '{}'::jsonb));
end;
$function$;

-- ---------------------------------------------------------------- K2 (Owner GO D4, 27 Nov): C4 lock order + G9-1
-- K2-a: the certificate issuer and the WAH issuance wrapper lock the schedule row before reading eligibility (RA2).
--       Function bodies are the reviewed pre-state (pinned above) plus one lock statement each.
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

  -- K2-a (RA2): take the schedule lock BEFORE reading eligibility. Training writes take FOR SHARE on this row
  -- (app.t1_participant_finalised), so a write that is still running finishes first and the eligibility read below
  -- (a new statement) sees it; a write that starts later waits for this issuance and then sees the certificate.
  perform 1 from public.course_schedules cs where cs.id = p_schedule_id for update;

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

  -- K2-a (RA2): lock the schedule before the authorization reads eligibility and the Skills Record. Lock order is
  -- schedule row, then the WAH authorization advisory lock, then (inside the issuer) the same schedule row again.
  perform 1 from public.course_schedules cs where cs.id = p_schedule_id for update;

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

-- K2-b: restoring a soft-deleted certificate takes the issuance locks and refuses a second active certificate.
CREATE OR REPLACE FUNCTION app.set_certificate_deleted(p_certificate_id uuid, p_deleted boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions'
AS $function$
declare
  v_actor uuid := auth.uid();
  v_cert public.certificates%rowtype;
begin
  if v_actor is null or not app.is_active() or not app.is_admin()
    or not public.has_module_access_level('certificates', 'admin') then
    raise exception 'Not authorized to change certificate deletion state.' using errcode = '42501';
  end if;
  select * into v_cert from public.certificates where id = p_certificate_id;
  if not found then
    raise exception 'Certificate not found.' using errcode = 'P0002';
  end if;
  if not p_deleted then
    -- K2-b: restoring re-activates a certificate, so it takes the same locks as issuance, in the same order (schedule
    -- row first; the participant row for a certificate without a schedule; the WAH authorization lock for WAH).
    if v_cert.schedule_id is not null then
      perform 1 from public.course_schedules s where s.id = v_cert.schedule_id for update;
    else
      perform 1 from public.participants p where p.id = v_cert.participant_id for no key update;
    end if;
    if app.is_wah_legacy_target(v_cert.course_id, v_cert.course_name) then
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('wah_issuance_authorization'));
    end if;
  end if;
  select * into v_cert from public.certificates where id = p_certificate_id for update;
  if not found then
    raise exception 'Certificate not found.' using errcode = 'P0002';
  end if;
  if not p_deleted and v_cert.deleted_at is not null and v_cert.status <> 'revoked' then
    -- Another active certificate in the same scope wins; history and /verify of every row are left as they are.
    if exists (
         select 1 from public.certificates c
         where c.id <> v_cert.id and c.deleted_at is null and c.status <> 'revoked'
           and c.participant_id = v_cert.participant_id
           and ((v_cert.schedule_id is not null and c.schedule_id = v_cert.schedule_id)
             or (v_cert.schedule_id is null and c.schedule_id is null
                 and coalesce(c.course_id::text, c.course_name) is not distinct from coalesce(v_cert.course_id::text, v_cert.course_name))))
       or (app.is_wah_legacy_target(v_cert.course_id, v_cert.course_name)
           and app.wah_participant_holds_certificate(v_cert.participant_id)) then
      raise exception 'CERTIFICATE_RESTORE_CONFLICT: another active certificate already exists for this participant and certification; revoke it or keep this one deleted.'
        using errcode = 'P0001';
    end if;
  end if;
  update public.certificates
  set deleted_at = case when p_deleted then now() else null end
  where id = p_certificate_id;
end;
$function$;

-- K2-c (G9-1): name and identity details are Super Admin only (and server sessions); INSERT is unchanged.
create or replace function app.t1_guard_participant_identity()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_clean text;
  v_last4 text;
begin
  -- Server sessions (service role, migrations: auth.uid() is null) and the Super Admin are not restricted.
  if auth.uid() is null or app.is_super_admin() then
    return new;
  end if;
  -- identity_last4 is derived by participants_sync_last4 (it runs first); only a value it would not produce is a change.
  v_clean := regexp_replace(coalesce(new.identity_no, ''), '[^0-9A-Za-z]', '', 'g');
  v_last4 := case when btrim(coalesce(new.identity_no, '')) <> '' and length(v_clean) >= 4 then upper(right(v_clean, 4))
                  else upper(right(regexp_replace(coalesce(old.identity_last4, ''), '[^0-9A-Za-z]', '', 'g'), 4)) end;
  if new.full_name is distinct from old.full_name
     or new.ic_passport_no is distinct from old.ic_passport_no
     or new.identity_no is distinct from old.identity_no
     or new.date_of_birth is distinct from old.date_of_birth
     or new.nationality is distinct from old.nationality
     or (new.identity_last4 is distinct from old.identity_last4 and new.identity_last4 is distinct from nullif(v_last4, '')) then
    raise exception using errcode = '42501',
      message = 'Only a Super Admin can change a participant''s name or identity details (use Participant Details Correction)';
  end if;
  return new;
end;
$function$;

create trigger trg_t1_participant_identity before update on public.participants
  for each row execute function app.t1_guard_participant_identity();

revoke all on function app.t1_guard_schedule_trainer() from public, anon, authenticated;
revoke all on function app.t1_guard_participant_identity() from public, anon, authenticated;
revoke all on function app.t1_guard_result_archive() from public, anon, authenticated;
revoke all on function app.t1_guard_assessment_accountability() from public, anon, authenticated;
revoke all on function app.t1_guard_skill_result_accountability() from public, anon, authenticated;
revoke all on function app.t1_guard_soft_delete() from public, anon, authenticated;
revoke all on function app.t1_guard_attendance_finalised() from public, anon, authenticated;

do $t1b_post$
begin
  if (select count(*) from pg_trigger where not tgisinternal and tgname like 'trg_t1_%') <> 11 then
    raise exception 't1b_postcondition_failed: expected 11 T1 triggers' using errcode = 'P0001';
  end if;
  -- K2-a: in both issuers the schedule lock comes before the eligibility / authorization read.
  if (select position('for update' in p.prosrc) = 0
            or position('for update' in p.prosrc) > position('from public.v_certificate_eligibility' in p.prosrc)
       from pg_proc p where p.oid = 'app.issue_certificate_with_skill_snapshot(uuid,uuid,text)'::regprocedure)
     or (select position('for update' in p.prosrc) = 0
            or position('for update' in p.prosrc) > position('authorize_wah_first_issuance' in p.prosrc)
       from pg_proc p where p.oid = 'app.issue_wah_certificate_as_super_admin(uuid,uuid,text)'::regprocedure)
     or position('CERTIFICATE_RESTORE_CONFLICT' in (select p.prosrc from pg_proc p where p.oid = 'app.set_certificate_deleted(uuid,boolean)'::regprocedure)) = 0 then
    raise exception 't1b_postcondition_failed: K2 certificate lock order / restore guard missing' using errcode = 'P0001';
  end if;
  if has_function_privilege('authenticated', 'app.t1_guard_participant_identity()', 'execute')
     or not has_function_privilege('authenticated', 'app.issue_certificate_with_skill_snapshot(uuid,uuid,text)', 'execute')
     or not has_function_privilege('authenticated', 'app.set_certificate_deleted(uuid,boolean)', 'execute') then
    raise exception 't1b_postcondition_failed: K2 grants changed' using errcode = 'P0001';
  end if;
  if has_function_privilege('authenticated', 'app.t1_participant_finalised(uuid,uuid)', 'execute')
     or has_function_privilege('anon', 'app.t1_participant_finalised(uuid,uuid)', 'execute')
     or has_function_privilege('authenticated', 'app.log_event(audit_action,text,text,text,jsonb)', 'execute')
     or has_function_privilege('anon', 'app.log_event(audit_action,text,text,text,jsonb)', 'execute') then
    raise exception 't1b_postcondition_failed: a T1 helper or app.log_event became client-callable' using errcode = 'P0001';
  end if;
  if position('attendance_undo' in (select p.prosrc from pg_proc p where p.oid = 'app.log_event(audit_action,text,text,text,jsonb)'::regprocedure)) = 0 then
    raise exception 't1b_postcondition_failed: app.log_event does not reserve attendance_undo' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.assessments where evidence_assessor_id is not null or evidence_reference is not null)
     or exists (select 1 from public.participant_skill_results where evidence_assessor_id is not null or evidence_reference is not null)
     or exists (select 1 from public.course_schedules where trainer_id is not null) then
    raise exception 't1b_postcondition_failed: new columns must start empty (no backfill)' using errcode = 'P0001';
  end if;
  if has_function_privilege('authenticated', 'app.t1_assert_assessment_evidence(uuid,uuid,uuid,text)', 'execute') then
    raise exception 't1b_postcondition_failed: evidence helper is executable by authenticated' using errcode = 'P0001';
  end if;
end;
$t1b_post$;
