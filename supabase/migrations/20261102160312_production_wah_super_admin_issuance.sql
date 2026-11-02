-- DRAFT -- NOT APPLIED. Owner rule: Working at Height certificates are issued one at a
-- time, and only by the TERAS Super Admin.
--
-- Target: Production iagzkrzeuawaxvacqprk only. Forward-only, additive. Depends on the
-- applied WAH issuance guard; a precondition aborts if it is absent.
--
-- What this adds, and nothing else:
--   * app.issue_wah_certificate_as_super_admin(): one transaction that (1) requires the
--     caller to be exactly an active super_admin, (2) creates a single-use authorization
--     through the existing owner function, which re-checks the schedule, branch,
--     eligibility and the four Skills Records, and (3) issues through the existing
--     issuer, whose insert consumes the authorization. If any step fails the whole
--     transaction rolls back, so no usable authorization survives a failed issuance.
--   * public.issue_wah_certificate_as_super_admin(): the thin wrapper the CRM calls.
--
-- Not changed: the issuance guard, its six sibling WAH triggers, the owner-only
-- authorization functions, the issuer, the eligibility view, other course families, or
-- any existing row. The default-deny guard still refuses every other path, including
-- the old public issuer and bulk generation.
--
-- Rollback (instant, keeps every authorization row as evidence): see the "rollback>" lines.

begin;

do $$
begin
  if not exists (select 1 from pg_trigger
                  where tgname = 'trg_certificates_a_wah_issuance_guard' and not tgisinternal
                    and tgrelid = to_regclass('public.certificates'))
     or to_regprocedure('app.authorize_wah_first_issuance(uuid,uuid,integer,text)') is null
     or to_regprocedure('app.issue_certificate_with_skill_snapshot(uuid,uuid,text)') is null then
    raise exception 'WAH Super Admin issuance requires the applied WAH issuance guard';
  end if;
end $$;

-- Exact role match on purpose: app.has_min_role('super_admin') would also be exact today,
-- but only because super_admin is the top of the enum, so a role added above it later
-- would silently inherit this path. Reads profiles by auth.uid(), the same source the
-- app.* role helpers use, and a missing or inactive profile is denied.
create or replace function app.issue_wah_certificate_as_super_admin(
  p_schedule_id uuid, p_participant_id uuid, p_certificate_number text default null)
 returns table(id uuid, verification_token text)
 language plpgsql
 security definer
 set search_path to 'pg_catalog'
as $function$
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

  -- Refuses unless the schedule is a completed WAH schedule with an active branch and the
  -- participant is eligible with all four Skills Records; a failure here rolls back with
  -- the caller. The authorization is consumed by the insert below in this same transaction.
  perform app.authorize_wah_first_issuance(
    p_schedule_id, p_participant_id, 5, 'SUPER_ADMIN_CRM:' || v_uid::text);

  return query
    select s.id, s.verification_token
    from app.issue_certificate_with_skill_snapshot(p_schedule_id, p_participant_id, p_certificate_number) s;
end;
$function$;
revoke all on function app.issue_wah_certificate_as_super_admin(uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function app.issue_wah_certificate_as_super_admin(uuid, uuid, text) to authenticated;

create or replace function public.issue_wah_certificate_as_super_admin(
  p_schedule_id uuid, p_participant_id uuid, p_certificate_number text default null)
 returns table(id uuid, verification_token text)
 language sql
 set search_path to 'pg_catalog', 'app'
as $function$
  select s.id, s.verification_token
  from app.issue_wah_certificate_as_super_admin(p_schedule_id, p_participant_id, p_certificate_number) s;
$function$;
revoke all on function public.issue_wah_certificate_as_super_admin(uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.issue_wah_certificate_as_super_admin(uuid, uuid, text) to authenticated;

commit;

-- Rollback: removes the new path only; the guard stays default-deny and every
-- authorization row stays as evidence.
-- rollback> drop function if exists public.issue_wah_certificate_as_super_admin(uuid, uuid, text);
-- rollback> drop function if exists app.issue_wah_certificate_as_super_admin(uuid, uuid, text);
