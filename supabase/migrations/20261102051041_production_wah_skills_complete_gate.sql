-- DRAFT -- NOT APPLIED. Owner rule: a new WAH certificate needs all four Skills
-- Record areas complete: Theory Session, Practical Training and Safety Awareness
-- Completed, and Practical Assessment Passed.
--
-- Target: Production iagzkrzeuawaxvacqprk only. Forward-only, additive. Depends on
-- the two applied WAH migrations; a precondition aborts if they are absent, which
-- also keeps this Production-specific draft off Staging.
--
-- What this changes, and nothing else: one BEFORE INSERT trigger on
-- certificate_issuance_snapshots, for the WAH course only. An incomplete record
-- aborts, which rolls back the whole issuance.
--
-- Not changed: the capture and issuance functions, v_certificate_eligibility, other
-- course families, or any existing row. Duplicates carry their source's frozen
-- record, so they pass through, and existing certificates are never re-checked.

begin;

do $$
begin
  if coalesce((select p.prosrc from pg_proc p where p.oid = to_regprocedure('app.capture_c4_wave1_erector_snapshot()')), '')
       not like '%WAH_FAILED_PRACTICAL_ASSESSMENT_HOLD%'
     or not exists (select 1 from pg_trigger
                     where tgname = 'trg_capture_c4_wave1_erector_snapshot' and not tgisinternal
                       and tgrelid = to_regclass('public.certificate_issuance_snapshots'))
     or not exists (select 1 from pg_trigger
                     where tgname = 'trg_guard_wah_skill_result' and not tgisinternal
                       and tgrelid = to_regclass('public.participant_skill_results')) then
    raise exception 'WAH skills gate requires both applied WAH migrations';
  end if;
  if not exists (select 1 from public.courses
                  where id = '963b1f6b-4c15-4833-90da-21aa0af0f544'::uuid and deleted_at is null) then
    raise exception 'WAH skills gate requires the Production WAH course';
  end if;
end $$;

-- Its name sorts after trg_capture_c4_wave1_erector_snapshot, so a Failed result
-- still reports the more specific hold first.
create or replace function app.guard_wah_skills_complete()
 returns trigger
 language plpgsql
 set search_path to 'pg_catalog'
as $function$
declare
  v_course_id uuid;
  v_replaces_certificate_id uuid;
begin
  select c.course_id, c.replaces_certificate_id
    into v_course_id, v_replaces_certificate_id
  from public.certificates c
  where c.id = new.certificate_id;

  if v_course_id is distinct from '963b1f6b-4c15-4833-90da-21aa0af0f544'::uuid
     or v_replaces_certificate_id is not null then
    return new;
  end if;

  if (select pg_catalog.count(*) from public.certificate_skill_results s
       where s.certificate_id = new.certificate_id
         and ((s.area in ('theory_session', 'practical_training', 'safety_awareness') and s.status = 'completed')
              or (s.area = 'practical_assessment' and s.status = 'passed'))) <> 4 then
    raise exception 'WAH_SKILLS_RECORD_INCOMPLETE: certificate not issued because the Skills Record is incomplete.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$function$;
revoke all on function app.guard_wah_skills_complete() from public, anon, authenticated;

drop trigger if exists trg_guard_wah_skills_complete on public.certificate_issuance_snapshots;
create trigger trg_guard_wah_skills_complete
  before insert on public.certificate_issuance_snapshots
  for each row execute function app.guard_wah_skills_complete();

commit;
