-- DRAFT -- NOT APPLIED. Owner rule: no new Working at Height certificate is issued
-- unless the owner has approved that one participant on that one schedule.
--
-- Target: Production iagzkrzeuawaxvacqprk only. Forward-only, additive. Depends on
-- the applied WAH migrations and the skills gate; a precondition aborts if they are
-- absent, which also keeps this Production-specific draft off Staging.
--
-- What this adds, and nothing else:
--   * app.wah_issuance_authorizations: single-use authorizations, empty on creation.
--   * app.guard_wah_issuance(): BEFORE INSERT or course change on public.certificates.
--     Every new WAH certificate is denied unless one open authorization matches its
--     schedule and participant; the matching row is consumed in the statement that issues.
--   * app.authorize_wah_first_issuance() / app.revoke_wah_issuance_authorization():
--     run by the database owner only. No API role can execute them.
--
-- Not changed: the issuer and duplicate functions, the skills gate, the Failed hold,
-- the schedule guard, v_certificate_eligibility, other course families, or any
-- existing row.
--
-- Rollback (instant, keeps the evidence table): see the "rollback>" lines at the end.

begin;

do $$
begin
  if not exists (select 1 from pg_trigger
                  where tgname = 'trg_guard_wah_skills_complete' and not tgisinternal
                    and tgrelid = to_regclass('public.certificate_issuance_snapshots'))
     or not exists (select 1 from pg_trigger
                     where tgname = 'trg_guard_wah_legacy_certificate' and not tgisinternal
                       and tgrelid = to_regclass('public.certificates'))
     or not exists (select 1 from pg_trigger
                     where tgname = 'trg_certificates_before_insert' and not tgisinternal
                       and tgrelid = to_regclass('public.certificates')) then
    raise exception 'WAH issuance guard requires the applied WAH migrations and skills gate';
  end if;
  if not exists (select 1 from public.courses
                  where id = '963b1f6b-4c15-4833-90da-21aa0af0f544'::uuid and deleted_at is null) then
    raise exception 'WAH issuance guard requires the Production WAH course';
  end if;
end $$;

create table if not exists app.wah_issuance_authorizations (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null,
  participant_id uuid not null,
  approval_ref text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_certificate_id uuid,
  revoked_at timestamptz,
  revoke_reason text,
  constraint wah_issuance_authorizations_approval_ref check (btrim(approval_ref) <> '' and length(approval_ref) <= 200),
  constraint wah_issuance_authorizations_window check (expires_at >= created_at + interval '5 minutes' and expires_at <= created_at + interval '60 minutes'),
  constraint wah_issuance_authorizations_one_close check (consumed_at is null or revoked_at is null),
  constraint wah_issuance_authorizations_consumed_pair check ((consumed_at is null) = (consumed_certificate_id is null))
);

-- Only one authorization can be open at any time, and one certificate can consume at most one.
create unique index if not exists wah_issuance_authorizations_one_open
  on app.wah_issuance_authorizations ((true)) where consumed_at is null and revoked_at is null;
create unique index if not exists wah_issuance_authorizations_certificate
  on app.wah_issuance_authorizations (consumed_certificate_id) where consumed_certificate_id is not null;

alter table app.wah_issuance_authorizations enable row level security;
revoke all on app.wah_issuance_authorizations from public, anon, authenticated, service_role;

-- Evidence rows are never deleted, and a closed row never changes again.
create or replace function app.guard_wah_issuance_authorization_rows()
 returns trigger
 language plpgsql
 set search_path to 'pg_catalog'
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'WAH_AUTHORIZATION_IMMUTABLE: authorizations are evidence and cannot be deleted.' using errcode = 'P0001';
  end if;
  if old.consumed_at is not null or old.revoked_at is not null
     or new.id is distinct from old.id
     or new.schedule_id is distinct from old.schedule_id
     or new.participant_id is distinct from old.participant_id
     or new.approval_ref is distinct from old.approval_ref
     or new.created_at is distinct from old.created_at
     or new.expires_at is distinct from old.expires_at then
    raise exception 'WAH_AUTHORIZATION_IMMUTABLE: an authorization can only be closed once.' using errcode = 'P0001';
  end if;
  return new;
end;
$function$;
revoke all on function app.guard_wah_issuance_authorization_rows() from public, anon, authenticated, service_role;

drop trigger if exists trg_guard_wah_issuance_authorization_rows on app.wah_issuance_authorizations;
create trigger trg_guard_wah_issuance_authorization_rows
  before update or delete on app.wah_issuance_authorizations
  for each row execute function app.guard_wah_issuance_authorization_rows();

-- Its name sorts before trg_certificates_before_insert, which allocates the certificate
-- number from a sequence that does not roll back, so a denied issuance burns no number.
-- WAH is recognised the way the legacy block recognises it, so a WAH-named row under
-- another course, which public verification would show as WAH, is denied too.
-- service_role can update certificates, and the historical guard only covers rows with
-- a snapshot, so moving an existing row into WAH is denied as well.
-- Replacements (duplicates) copy their source, so they pass only as an exact identity
-- copy of an existing WAH certificate; the flag cannot mint one for someone new.
create or replace function app.guard_wah_issuance()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'pg_catalog'
as $function$
declare
  v_authorization_id uuid;
begin
  if not app.is_wah_legacy_target(new.course_id, new.course_name) then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if app.is_wah_legacy_target(old.course_id, old.course_name) then
      return new;
    end if;
    raise exception 'WAH_ISSUANCE_NOT_AUTHORIZED: an existing certificate cannot be moved into Working at Height.'
      using errcode = 'P0001';
  end if;

  if new.replaces_certificate_id is not null then
    if exists (select 1 from public.certificates src
                where src.id = new.replaces_certificate_id
                  and app.is_wah_legacy_target(src.course_id, src.course_name)
                  and src.course_id is not distinct from new.course_id
                  and src.participant_id is not distinct from new.participant_id
                  and src.holder_name is not distinct from new.holder_name) then
      return new;
    end if;
    raise exception 'WAH_REPLACEMENT_REFERENCE_INVALID: a replacement must be an exact copy of an existing Working at Height certificate of the same holder.'
      using errcode = 'P0001';
  end if;

  update app.wah_issuance_authorizations a
     set consumed_at = pg_catalog.clock_timestamp(), consumed_certificate_id = new.id
   where a.schedule_id = new.schedule_id
     and a.participant_id = new.participant_id
     and a.consumed_at is null
     and a.revoked_at is null
     and a.expires_at > pg_catalog.clock_timestamp()
  returning a.id into v_authorization_id;

  if v_authorization_id is null then
    raise exception 'WAH_ISSUANCE_NOT_AUTHORIZED: Working at Height issuance needs a current owner authorization for this participant and schedule.'
      using errcode = 'P0001';
  end if;

  insert into public.audit_logs (actor_id, actor_email, action, entity_type, entity_id, summary, metadata)
  values (auth.uid(), null, 'update'::public.audit_action, 'wah_issuance_authorizations', v_authorization_id::text,
          'WAH issuance authorization consumed',
          pg_catalog.jsonb_build_object('event', 'consumed', 'certificate_id', new.id,
                                        'schedule_id', new.schedule_id, 'participant_id', new.participant_id));
  return new;
end;
$function$;
revoke all on function app.guard_wah_issuance() from public, anon, authenticated, service_role;

drop trigger if exists trg_certificates_a_wah_issuance_guard on public.certificates;
create trigger trg_certificates_a_wah_issuance_guard
  before insert or update of course_id, course_name on public.certificates
  for each row execute function app.guard_wah_issuance();

-- Owner-run only. It refuses unless the schedule and participant are ready to issue
-- right now, so a bad request fails here and not in front of the staff member.
create or replace function app.authorize_wah_first_issuance(
  p_schedule_id uuid, p_participant_id uuid, p_minutes integer, p_approval_ref text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'pg_catalog'
as $function$
declare
  v_wah constant uuid := '963b1f6b-4c15-4833-90da-21aa0af0f544';
  v_id uuid;
  v_expired uuid;
  v_branch uuid;
  v_eligible boolean;
  v_reason text;
begin
  if p_minutes is null or p_minutes < 5 or p_minutes > 60 then
    raise exception 'WAH_AUTHORIZATION_INVALID: validity must be 5 to 60 minutes.' using errcode = 'P0001';
  end if;
  if p_approval_ref is null or pg_catalog.btrim(p_approval_ref) = '' or pg_catalog.length(p_approval_ref) > 200 then
    raise exception 'WAH_AUTHORIZATION_INVALID: an owner approval reference is required.' using errcode = 'P0001';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('wah_issuance_authorization'));

  -- Expired authorizations close themselves here, with an audit row, so they never block a new one.
  for v_expired in
    with closed as (
      update app.wah_issuance_authorizations
         set revoked_at = pg_catalog.clock_timestamp(), revoke_reason = 'expired'
       where consumed_at is null and revoked_at is null and expires_at <= pg_catalog.clock_timestamp()
      returning id)
    select id from closed
  loop
    insert into public.audit_logs (actor_id, actor_email, action, entity_type, entity_id, summary, metadata)
    values (auth.uid(), null, 'update'::public.audit_action, 'wah_issuance_authorizations', v_expired::text,
            'WAH issuance authorization expired', pg_catalog.jsonb_build_object('event', 'expired'));
  end loop;

  if exists (select 1 from app.wah_issuance_authorizations where consumed_at is null and revoked_at is null) then
    raise exception 'WAH_AUTHORIZATION_ALREADY_OPEN: revoke the open authorization first.' using errcode = 'P0001';
  end if;

  select cs.branch_id into v_branch
  from public.course_schedules cs
  where cs.id = p_schedule_id and cs.deleted_at is null and cs.course_id = v_wah and cs.status = 'completed';
  if not found then
    raise exception 'WAH_AUTHORIZATION_INVALID: not a completed Working at Height schedule.' using errcode = 'P0001';
  end if;
  if v_branch is null or not exists (select 1 from public.certificate_branches b where b.id = v_branch and b.is_active) then
    raise exception 'WAH_AUTHORIZATION_INVALID: the schedule has no active issuing branch.' using errcode = 'P0001';
  end if;

  select v.eligible, v.ineligibility_reason into v_eligible, v_reason
  from public.v_certificate_eligibility v
  where v.schedule_id = p_schedule_id and v.participant_id = p_participant_id;
  if not found or v_eligible is not true then
    raise exception 'WAH_AUTHORIZATION_INVALID: not eligible (%).', coalesce(v_reason, 'no_eligibility_row') using errcode = 'P0001';
  end if;

  if (select pg_catalog.count(*) from public.participant_skill_results r
       where r.schedule_id = p_schedule_id and r.participant_id = p_participant_id and r.deleted_at is null
         and ((r.area in ('theory_session', 'practical_training', 'safety_awareness') and r.status = 'completed')
              or (r.area = 'practical_assessment' and r.status = 'passed'))) <> 4
     or exists (select 1 from public.participant_skill_results r
                 where r.schedule_id = p_schedule_id and r.participant_id = p_participant_id
                   and r.deleted_at is null and r.status = 'failed') then
    raise exception 'WAH_AUTHORIZATION_INVALID: the Skills Record is not complete.' using errcode = 'P0001';
  end if;

  insert into app.wah_issuance_authorizations (schedule_id, participant_id, approval_ref, expires_at)
  values (p_schedule_id, p_participant_id, pg_catalog.btrim(p_approval_ref),
          pg_catalog.now() + pg_catalog.make_interval(mins => p_minutes))
  returning id into v_id;

  insert into public.audit_logs (actor_id, actor_email, action, entity_type, entity_id, summary, metadata)
  values (auth.uid(), null, 'create'::public.audit_action, 'wah_issuance_authorizations', v_id::text,
          'WAH issuance authorization created',
          pg_catalog.jsonb_build_object('event', 'created', 'approval_ref', pg_catalog.btrim(p_approval_ref),
                                        'schedule_id', p_schedule_id, 'participant_id', p_participant_id,
                                        'minutes', p_minutes, 'db_role', session_user));
  return v_id;
end;
$function$;
revoke all on function app.authorize_wah_first_issuance(uuid, uuid, integer, text) from public, anon, authenticated, service_role;

create or replace function app.revoke_wah_issuance_authorization(p_id uuid, p_reason text)
 returns void
 language plpgsql
 security definer
 set search_path to 'pg_catalog'
as $function$
begin
  if p_reason is null or pg_catalog.btrim(p_reason) = '' then
    raise exception 'WAH_AUTHORIZATION_INVALID: a revocation reason is required.' using errcode = 'P0001';
  end if;
  update app.wah_issuance_authorizations
     set revoked_at = pg_catalog.clock_timestamp(), revoke_reason = pg_catalog.btrim(p_reason)
   where id = p_id and consumed_at is null and revoked_at is null;
  if not found then
    raise exception 'WAH_AUTHORIZATION_INVALID: no open authorization with that id.' using errcode = 'P0001';
  end if;
  insert into public.audit_logs (actor_id, actor_email, action, entity_type, entity_id, summary, metadata)
  values (auth.uid(), null, 'update'::public.audit_action, 'wah_issuance_authorizations', p_id::text,
          'WAH issuance authorization revoked',
          pg_catalog.jsonb_build_object('event', 'revoked', 'reason', pg_catalog.btrim(p_reason), 'db_role', session_user));
end;
$function$;
revoke all on function app.revoke_wah_issuance_authorization(uuid, text) from public, anon, authenticated, service_role;

commit;

-- Rollback: the first line stops the guard at once and keeps every authorization row as
-- evidence; the rest remove the functions. Drop the table only if it holds no rows.
-- rollback> alter table public.certificates disable trigger trg_certificates_a_wah_issuance_guard;
-- rollback> drop trigger if exists trg_certificates_a_wah_issuance_guard on public.certificates;
-- rollback> drop function if exists app.guard_wah_issuance();
-- rollback> drop function if exists app.authorize_wah_first_issuance(uuid, uuid, integer, text);
-- rollback> drop function if exists app.revoke_wah_issuance_authorization(uuid, text);
