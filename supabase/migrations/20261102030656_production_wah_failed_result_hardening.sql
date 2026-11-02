-- DRAFT -- NOT APPLIED. C4E-2H/2K: protect recorded WAH Failed Practical Assessments,
-- close the legacy paths to WAH, and keep populated WAH schedules in place.
--
-- Target: Production iagzkrzeuawaxvacqprk only. Forward-only, additive. Depends on
-- 20261102000000_production_wah_c4_snapshot_dispatch.sql, whose issuance hold reads
-- the result this file protects. A precondition aborts if that hold is absent.
--
-- What this changes, and nothing else:
--   1. A guard on participant_skill_results, for WAH schedules only: identity
--      fields are immutable, assessment locks hold at the database boundary, per-
--      area statuses are enforced, and an active Failed Practical Assessment
--      cannot be changed or deleted outside the correction function.
--   2. app.correct_wah_failed_practical_assessment(): the only way to change an
--      active Failed result. Admin only, reason and evidence reference required.
--      It writes old and new values to audit_logs in the same transaction.
--   3. New legacy certificates and legacy-batch schedules for WAH are rejected.
--      A stored date or identity cannot show a legacy import is genuinely
--      historical, so the block does not read them, and it needs no Failed row.
--      Any exception must be a separate, owner-approved change.
--   4. A WAH schedule with enrolments, attendance, skill results or certificates
--      cannot be hard-deleted, and no populated schedule can move on to or off WAH.
--      Both would otherwise switch off the guard in (1), which finds WAH via the
--      schedule, and old attendance would count towards WAH eligibility after a move.
--   5. Revokes grants on audit_logs, participant_skill_results, course_schedules and
--      schedule_participants that no application path uses and that row triggers
--      and RLS do not cover (TRUNCATE).
--
-- Not changed: v_certificate_eligibility, the issuance and duplicate functions,
-- the legacy functions themselves, assessments, other course families, or any
-- existing row. Every guard fires only on new writes, so existing certificates,
-- including any legacy-marked row, are never rewritten.

begin;

do $$
begin
  if coalesce((select p.prosrc from pg_proc p where p.oid = to_regprocedure('app.capture_c4_wave1_erector_snapshot()')), '')
       not like '%WAH_FAILED_PRACTICAL_ASSESSMENT_HOLD%' then
    raise exception 'WAH hardening requires the WAH C4 dispatch draft to be applied first';
  end if;
  if not exists (select 1 from public.courses
                  where id = '963b1f6b-4c15-4833-90da-21aa0af0f544'::uuid and deleted_at is null) then
    raise exception 'WAH hardening requires the Production WAH course';
  end if;
  if (select count(*) from information_schema.columns
       where table_schema = 'public'
         and (table_name, column_name) in (('certificates', 'legacy_batch_id'), ('certificates', 'metadata'), ('course_schedules', 'legacy_batch_id'),
                                           ('courses', 'title'), ('courses', 'course_name'), ('courses', 'course_code'))) <> 6 then
    raise exception 'WAH hardening requires the legacy provenance and course identity columns';
  end if;
  if exists (
    select 1 from public.participant_skill_results r
    join public.course_schedules cs on cs.id = r.schedule_id
    where cs.course_id = '963b1f6b-4c15-4833-90da-21aa0af0f544'::uuid
      and r.status <> 'not_recorded'
      and not (r.area = 'practical_assessment' and r.status in ('passed', 'failed'))
      and not (r.area <> 'practical_assessment' and r.status = 'completed')
  ) then
    raise exception 'WAH hardening found existing skill rows outside the per-area status rules';
  end if;
end $$;

-- The guard runs as the caller, so it needs this one narrow definer read.
create or replace function app.wah_skill_result_context(
  p_schedule_id uuid, p_participant_id uuid, out is_wah boolean, out is_locked boolean
)
 language sql
 stable
 security definer
 set search_path to 'pg_catalog'
as $function$
  select
    exists (select 1 from public.course_schedules cs
             where cs.id = p_schedule_id
               and cs.course_id = '963b1f6b-4c15-4833-90da-21aa0af0f544'::uuid),
    exists (select 1 from public.assessments a
             where a.schedule_id = p_schedule_id
               and a.participant_id = p_participant_id
               and a.deleted_at is null
               and a.locked);
$function$;
revoke all on function app.wah_skill_result_context(uuid, uuid) from public, anon;
grant execute on function app.wah_skill_result_context(uuid, uuid) to authenticated, service_role;

-- Deliberately not SECURITY DEFINER: current_user must still identify the caller,
-- so only the correction function's owner context can pass. RLS and BYPASSRLS do
-- not matter here, so service_role is held to the same rule.
create or replace function app.guard_wah_skill_result()
 returns trigger
 language plpgsql
 set search_path to 'pg_catalog'
as $function$
declare
  v_old_wah boolean := false;
  v_old_locked boolean := false;
  v_new_wah boolean := false;
  v_new_locked boolean := false;
begin
  if tg_op <> 'INSERT' then
    select c.is_wah, c.is_locked into v_old_wah, v_old_locked
    from app.wah_skill_result_context(old.schedule_id, old.participant_id) c;
  end if;
  if tg_op <> 'DELETE' then
    select c.is_wah, c.is_locked into v_new_wah, v_new_locked
    from app.wah_skill_result_context(new.schedule_id, new.participant_id) c;
  end if;

  if not (v_old_wah or v_new_wah) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'UPDATE' and (new.id is distinct from old.id
       or new.schedule_id is distinct from old.schedule_id
       or new.participant_id is distinct from old.participant_id
       or new.area is distinct from old.area) then
    raise exception 'WAH_SKILL_RESULT_IDENTITY_IMMUTABLE: schedule, participant and assessment area cannot be changed.'
      using errcode = '42501';
  end if;

  if v_old_locked or v_new_locked then
    raise exception 'WAH_SKILL_RESULT_LOCKED: this participant''s assessment is locked.'
      using errcode = '42501';
  end if;

  if tg_op <> 'DELETE' and not (
    new.status = 'not_recorded'
    or (new.area = 'practical_assessment' and new.status in ('passed', 'failed'))
    or (new.area <> 'practical_assessment' and new.status = 'completed')
  ) then
    raise exception 'WAH_SKILL_RESULT_INVALID_STATUS: % is not valid for %.', new.status, new.area
      using errcode = '23514';
  end if;

  if tg_op <> 'INSERT' and old.area = 'practical_assessment' and old.status = 'failed' and old.deleted_at is null then
    if tg_op = 'DELETE' then
      raise exception 'WAH_FAILED_RESULT_PROTECTED: a recorded Failed Practical Assessment cannot be deleted.'
        using errcode = '42501';
    end if;
    if new.status is distinct from old.status
       or new.score is distinct from old.score
       or new.notes is distinct from old.notes
       or new.deleted_at is distinct from old.deleted_at
       or new.assessed_by is distinct from old.assessed_by
       or new.assessed_at is distinct from old.assessed_at
       or new.locked is distinct from old.locked
       or new.locked_at is distinct from old.locked_at
       or new.locked_by is distinct from old.locked_by then
      if current_user is distinct from (
           select pg_catalog.pg_get_userbyid(p.proowner) from pg_catalog.pg_proc p
           where p.oid = 'app.correct_wah_failed_practical_assessment(uuid,uuid,text,text,text)'::regprocedure)
         or pg_catalog.current_setting('app.wah_failed_correction', true) is distinct from (old.id::text || ':' || new.status)
         or new.status not in ('passed', 'not_recorded')
         or new.score is distinct from old.score
         or new.notes is distinct from old.notes
         or new.deleted_at is distinct from old.deleted_at
         or new.locked is distinct from old.locked
         or new.locked_at is distinct from old.locked_at
         or new.locked_by is distinct from old.locked_by then
        raise exception 'WAH_FAILED_RESULT_PROTECTED: only the Admin correction can change a recorded Failed Practical Assessment.'
          using errcode = '42501';
      end if;
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

create or replace function app.correct_wah_failed_practical_assessment(
  p_schedule_id uuid, p_participant_id uuid, p_new_status text, p_reason text, p_evidence_reference text
)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'app', 'extensions', 'pg_temp'
as $function$
declare
  v_actor uuid := auth.uid();
  v_email text;
  v_reason text := nullif(btrim(p_reason), '');
  v_evidence text := nullif(btrim(p_evidence_reference), '');
  v_row public.participant_skill_results%rowtype;
begin
  if v_actor is null or not app.is_active() or not app.is_admin()
     or not public.has_module_access_level('assessment', 'admin') then
    raise exception 'Not authorized to correct a Failed Practical Assessment.' using errcode = '42501';
  end if;
  if p_new_status is null or p_new_status not in ('passed', 'not_recorded') then
    raise exception 'A corrected status must be Passed or Not Recorded.' using errcode = '22023';
  end if;
  if v_reason is null or length(v_reason) < 10 or length(v_reason) > 1000 then
    raise exception 'A correction reason of 10 to 1000 characters is required.' using errcode = '22023';
  end if;
  if v_evidence is null or length(v_evidence) < 3 or length(v_evidence) > 200 then
    raise exception 'An evidence reference of 3 to 200 characters is required.' using errcode = '22023';
  end if;

  select r.* into v_row
  from public.participant_skill_results r
  join public.course_schedules cs on cs.id = r.schedule_id
  where r.schedule_id = p_schedule_id
    and r.participant_id = p_participant_id
    and r.area = 'practical_assessment'
    and r.status = 'failed'
    and r.deleted_at is null
    and cs.course_id = '963b1f6b-4c15-4833-90da-21aa0af0f544'::uuid
  for update of r;
  if not found then
    raise exception 'No active Failed WAH Practical Assessment was found.' using errcode = 'P0002';
  end if;

  select email into v_email from public.profiles where id = v_actor;

  perform set_config('app.wah_failed_correction', v_row.id::text || ':' || p_new_status, true);
  update public.participant_skill_results
     set status = p_new_status, assessed_by = v_actor, assessed_at = now()
   where id = v_row.id;
  perform set_config('app.wah_failed_correction', '', true);

  -- Same transaction: if this insert fails, the correction rolls back with it.
  insert into public.audit_logs (actor_id, actor_email, action, entity_type, entity_id, summary, metadata)
  values (v_actor, v_email, 'update', 'participant_skill_results', v_row.id::text,
    'WAH Failed Practical Assessment corrected',
    jsonb_build_object(
      'correction', 'wah_failed_practical_assessment',
      'schedule_id', v_row.schedule_id,
      'participant_id', v_row.participant_id,
      'area', v_row.area,
      'old_status', v_row.status,
      'new_status', p_new_status,
      'reason', v_reason,
      'evidence_reference', v_evidence
    ));

  return v_row.id;
end;
$function$;
revoke all on function app.correct_wah_failed_practical_assessment(uuid, uuid, text, text, text) from public, anon;
grant execute on function app.correct_wah_failed_practical_assessment(uuid, uuid, text, text, text) to authenticated;

create or replace function public.correct_wah_failed_practical_assessment(
  p_schedule_id uuid, p_participant_id uuid, p_new_status text, p_reason text, p_evidence_reference text
)
 returns uuid
 language sql
 set search_path to 'pg_catalog', 'app'
as $function$
  select app.correct_wah_failed_practical_assessment(p_schedule_id, p_participant_id, p_new_status, p_reason, p_evidence_reference);
$function$;
revoke all on function public.correct_wah_failed_practical_assessment(uuid, uuid, text, text, text) from public, anon;
grant execute on function public.correct_wah_failed_practical_assessment(uuid, uuid, text, text, text) to authenticated;

drop trigger if exists trg_guard_wah_skill_result on public.participant_skill_results;
create trigger trg_guard_wah_skill_result
  before insert or update or delete on public.participant_skill_results
  for each row execute function app.guard_wah_skill_result();

-- Mirrored by isWahCourseLabel in lib/certificates/wah-legacy-block.ts.
create or replace function app.is_wah_course_label(p_label text)
 returns boolean
 language sql
 immutable
 set search_path to 'pg_catalog'
as $function$
  select coalesce(
    p_label ~* '(^|[^[:alnum:]])work(ing)?[[:space:]_-]*at[[:space:]_-]*heights?([^[:alnum:]]|$)'
    or p_label ~* '(^|[^[:alnum:]])wah([^[:alnum:]]|$)',
    false);
$function$;
revoke all on function app.is_wah_course_label(text) from public, anon, authenticated;

-- Names only widen the block: a caller can pick a course or name to dodge the UUID
-- check, but no name can lift it. Public verification shows the name, which is why
-- a WAH-named certificate under another course is refused too.
create or replace function app.is_wah_legacy_target(p_course_id uuid, p_course_name text)
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'pg_catalog'
as $function$
  select coalesce(p_course_id = '963b1f6b-4c15-4833-90da-21aa0af0f544'::uuid, false)
    or app.is_wah_course_label(p_course_name)
    or exists (
      select 1 from public.courses co
      where co.id = p_course_id
        and (app.is_wah_course_label(co.title)
             or app.is_wah_course_label(co.course_name)
             or app.is_wah_course_label(co.course_code)));
$function$;
revoke all on function app.is_wah_legacy_target(uuid, text) from public, anon, authenticated;

-- Both legacy functions set one of these markers. Issuance and duplication set
-- neither, and direct inserts are already denied to API roles.
create or replace function app.guard_wah_legacy_certificate()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'pg_catalog'
as $function$
begin
  if (new.legacy_batch_id is not null or new.metadata->>'provenance' = 'legacy_import')
     and app.is_wah_legacy_target(new.course_id, new.course_name) then
    raise exception 'WAH_LEGACY_IMPORT_DISABLED: Working at Height certificates cannot be created through a legacy import.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$function$;
revoke all on function app.guard_wah_legacy_certificate() from public, anon, authenticated;

drop trigger if exists trg_guard_wah_legacy_certificate on public.certificates;
create trigger trg_guard_wah_legacy_certificate
  before insert on public.certificates
  for each row execute function app.guard_wah_legacy_certificate();

-- Rows are counted whatever their deleted_at or status, so soft-deleting them first
-- does not make a schedule look empty. Hard-deleting a row first still does, except
-- a Failed result, which the skill result guard refuses, and certificates, which API
-- roles cannot delete.
create or replace function app.guard_wah_schedule_integrity()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'pg_catalog'
as $function$
declare
  v_wah constant uuid := '963b1f6b-4c15-4833-90da-21aa0af0f544'::uuid;
  v_schedule_id uuid;
  v_populated boolean;
begin
  if tg_op <> 'DELETE' and new.legacy_batch_id is not null
     and app.is_wah_legacy_target(new.course_id, null) then
    raise exception 'WAH_LEGACY_SCHEDULE_DISABLED: Working at Height schedules cannot be created through a legacy import.'
      using errcode = 'P0001';
  end if;

  if tg_op = 'INSERT' then
    return new;
  end if;
  if tg_op = 'DELETE' and old.course_id is distinct from v_wah then
    return old;
  end if;
  if tg_op = 'UPDATE' and (new.course_id is not distinct from old.course_id
       or (new.course_id is distinct from v_wah and old.course_id is distinct from v_wah)) then
    return new;
  end if;

  v_schedule_id := old.id;
  v_populated := exists (select 1 from public.schedule_participants sp where sp.schedule_id = v_schedule_id)
    or exists (select 1 from public.attendance a where a.schedule_id = v_schedule_id)
    or exists (select 1 from public.participant_skill_results r where r.schedule_id = v_schedule_id)
    or exists (select 1 from public.certificates c where c.schedule_id = v_schedule_id);

  if v_populated then
    if tg_op = 'DELETE' then
      raise exception 'WAH_SCHEDULE_DELETE_BLOCKED: a Working at Height schedule with enrolments, attendance, skill results or certificates cannot be deleted.'
        using errcode = '42501';
    end if;
    raise exception 'WAH_SCHEDULE_COURSE_LOCKED: a schedule with enrolments, attendance, skill results or certificates cannot be moved on to or off Working at Height.'
      using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;
revoke all on function app.guard_wah_schedule_integrity() from public, anon, authenticated;

drop trigger if exists trg_guard_wah_schedule_integrity on public.course_schedules;
create trigger trg_guard_wah_schedule_integrity
  before insert or update of course_id, legacy_batch_id or delete on public.course_schedules
  for each row execute function app.guard_wah_schedule_integrity();

revoke update, delete, truncate, references, trigger on public.audit_logs from anon, authenticated;
revoke truncate, references, trigger on public.participant_skill_results from anon, authenticated;
revoke truncate, references, trigger on public.course_schedules from anon, authenticated;
revoke truncate, references, trigger on public.schedule_participants from anon, authenticated;

commit;
