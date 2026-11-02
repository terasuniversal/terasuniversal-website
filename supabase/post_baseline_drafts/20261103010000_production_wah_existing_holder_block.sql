-- DRAFT -- NOT APPLIED. Owner rule: the Super Admin path must not issue a second Working
-- at Height certificate to someone who already holds an active one.
--
-- Why: certificates_active_schedule_participant_uniq and v_certificate_eligibility only
-- look at one schedule, so a holder enrolled on a later schedule shows as eligible there.
--
-- Target: Production iagzkrzeuawaxvacqprk only. Forward-only, additive. Depends on the
-- applied Super Admin issuance function; a precondition aborts if it is absent.
--
-- What this adds, and nothing else:
--   * app.wah_participant_holds_certificate(): one definition of "already holds".
--   * app.issue_wah_certificate_as_super_admin(): refuses a holder, in the same transaction.
--   * app/public.wah_certificate_holders_on_schedule(): lets the Generate page show the hold.
--
-- Not changed: the issuance guard, the six WAH triggers, the owner-only authorization
-- functions (still the deliberate route if the owner approves a further certificate), the
-- issuer, the duplicate function used for replacements, other course families, or any row.
--
-- Rollback: re-run supabase/migrations/20261102160312_production_wah_super_admin_issuance.sql
-- to restore the previous function, then run the "rollback>" lines.

begin;

do $$
begin
  if to_regprocedure('app.issue_wah_certificate_as_super_admin(uuid,uuid,text)') is null
     or to_regprocedure('app.is_wah_legacy_target(uuid,text)') is null then
    raise exception 'WAH holder block requires the applied WAH Super Admin issuance';
  end if;
end $$;

-- Revoked and deleted certificates do not count. WAH is recognised as the legacy block
-- recognises it. Identity numbers are compared without punctuation, across the certificate
-- and its participant record, so a second participant record for one person still matches.
create or replace function app.wah_participant_holds_certificate(p_participant_id uuid)
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'pg_catalog'
as $function$
  with me as (
    select upper(regexp_replace(coalesce(p.identity_no, ''), '[^0-9A-Za-z]', '', 'g')) as identity_no,
           upper(regexp_replace(coalesce(p.ic_passport_no, ''), '[^0-9A-Za-z]', '', 'g')) as ic_passport_no
    from public.participants p
    where p.id = p_participant_id
  )
  select exists (
    select 1
    from public.certificates c
    left join public.participants holder on holder.id = c.participant_id
    cross join lateral (values
      (upper(regexp_replace(coalesce(c.identity_no, ''), '[^0-9A-Za-z]', '', 'g'))),
      (upper(regexp_replace(coalesce(holder.identity_no, ''), '[^0-9A-Za-z]', '', 'g'))),
      (upper(regexp_replace(coalesce(holder.ic_passport_no, ''), '[^0-9A-Za-z]', '', 'g')))
    ) as known(identity_value)
    where c.deleted_at is null
      and c.status <> 'revoked'
      and app.is_wah_legacy_target(c.course_id, c.course_name)
      and (c.participant_id = p_participant_id
           or (known.identity_value <> ''
               and exists (select 1 from me
                            where known.identity_value in (me.identity_no, me.ic_passport_no))))
  );
$function$;
revoke all on function app.wah_participant_holds_certificate(uuid) from public, anon, authenticated, service_role;

-- Same as 20261102160312 plus the holder check. The check runs after the authorization
-- because that call takes the advisory lock, so two requests for one person are serialized.
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
revoke all on function app.issue_wah_certificate_as_super_admin(uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function app.issue_wah_certificate_as_super_admin(uuid, uuid, text) to authenticated;

create or replace function app.wah_certificate_holders_on_schedule(p_schedule_id uuid)
 returns table(participant_id uuid)
 language plpgsql
 stable
 security definer
 set search_path to 'pg_catalog'
as $function$
begin
  if not (app.is_active() and app.is_admin()) then
    raise exception 'Not authorized to read certificate holders.' using errcode = '42501';
  end if;
  return query
    select sp.participant_id
    from public.schedule_participants sp
    where sp.schedule_id = p_schedule_id
      and sp.deleted_at is null
      and app.wah_participant_holds_certificate(sp.participant_id);
end;
$function$;
revoke all on function app.wah_certificate_holders_on_schedule(uuid) from public, anon, authenticated, service_role;
grant execute on function app.wah_certificate_holders_on_schedule(uuid) to authenticated;

create or replace function public.wah_certificate_holders_on_schedule(p_schedule_id uuid)
 returns table(participant_id uuid)
 language sql
 stable
 set search_path to 'pg_catalog', 'app'
as $function$
  select h.participant_id from app.wah_certificate_holders_on_schedule(p_schedule_id) h;
$function$;
revoke all on function public.wah_certificate_holders_on_schedule(uuid) from public, anon, authenticated, service_role;
grant execute on function public.wah_certificate_holders_on_schedule(uuid) to authenticated;

commit;

-- rollback> drop function if exists public.wah_certificate_holders_on_schedule(uuid);
-- rollback> drop function if exists app.wah_certificate_holders_on_schedule(uuid);
-- rollback> drop function if exists app.wah_participant_holds_certificate(uuid);
