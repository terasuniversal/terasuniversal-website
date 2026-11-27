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
--            certificate issuance that already holds FOR UPDATE on it and then sees the committed certificate. The
--            issuer itself still reads eligibility before locking (C4, HOLD): a write that STARTS before the issuer
--            locks the schedule can still race it; that order is closed only by the deferred C4 change.
--      C1-b: the Undo audit row is written directly (not through log_event) and app.log_event refuses the reserved
--            entity type attendance_undo, so no caller of log_event can forge one. Other log_event uses are unchanged.
--  * T1-a lets Training Ops Staff update schedules, enrolments, participants and trainers; soft delete / restore
--    (deleted_at) keeps its previous floor: the Admin role (app.is_admin()). Archiving an assessment or a skill
--    result (an indirect DELETE) needs the Admin role too; re-recording a previously archived skill area is allowed.
-- Not changed: scoring, thresholds, competency rules, the WAH guards and correction RPC (exempted by the same
-- transaction marker they already use), certificate eligibility/issuance, /verify, the existing integrity trigger.
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

revoke all on function app.t1_guard_schedule_trainer() from public, anon, authenticated;
revoke all on function app.t1_guard_result_archive() from public, anon, authenticated;
revoke all on function app.t1_guard_assessment_accountability() from public, anon, authenticated;
revoke all on function app.t1_guard_skill_result_accountability() from public, anon, authenticated;
revoke all on function app.t1_guard_soft_delete() from public, anon, authenticated;
revoke all on function app.t1_guard_attendance_finalised() from public, anon, authenticated;

do $t1b_post$
begin
  if (select count(*) from pg_trigger where not tgisinternal and tgname like 'trg_t1_%') <> 10 then
    raise exception 't1b_postcondition_failed: expected 10 T1 triggers' using errcode = 'P0001';
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
