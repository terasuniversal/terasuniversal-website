-- Keep the pre-existing issuance API wrapper equally narrow and explicitly
-- exclude anon/service_role. Its business logic remains in app.*.
BEGIN;

alter function public.issue_certificate_with_skill_snapshot(uuid, uuid, text)
  set search_path = pg_catalog, app;

revoke all on function public.issue_certificate_with_skill_snapshot(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.issue_certificate_with_skill_snapshot(uuid, uuid, text)
  to authenticated;

-- Expose only the certificate lifecycle RPCs required by the authenticated
-- Server Actions. Authorization and all lifecycle behavior remain in app.*.

create or replace function public.duplicate_certificate_with_skill_snapshot(
  p_source_certificate_id uuid
)
returns table (id uuid, verification_token text)
language sql
security invoker
set search_path = pg_catalog, app
as $$
  select * from app.duplicate_certificate_with_skill_snapshot(p_source_certificate_id);
$$;

create or replace function public.reissue_certificate(
  p_certificate_id uuid,
  p_event_type text default 'reissue',
  p_reason text default null,
  p_notes jsonb default '{}'::jsonb
)
returns table (id uuid, certificate_id uuid, certificate_number text, event_type text, reissued_at timestamptz)
language sql
security invoker
set search_path = pg_catalog, app
as $$
  select * from app.reissue_certificate(p_certificate_id, p_event_type, p_reason, p_notes);
$$;

create or replace function public.revoke_certificate(
  p_certificate_id uuid,
  p_remarks text default null
)
returns void
language sql
security invoker
set search_path = pg_catalog, app
as $$
  select app.revoke_certificate(p_certificate_id, p_remarks);
$$;

create or replace function public.update_certificate_metadata(
  p_certificate_id uuid,
  p_expiry_date date default null,
  p_remarks text default null
)
returns void
language sql
security invoker
set search_path = pg_catalog, app
as $$
  select app.update_certificate_metadata(p_certificate_id, p_expiry_date, p_remarks);
$$;

create or replace function public.set_certificate_deleted(
  p_certificate_id uuid,
  p_deleted boolean
)
returns void
language sql
security invoker
set search_path = pg_catalog, app
as $$
  select app.set_certificate_deleted(p_certificate_id, p_deleted);
$$;

create or replace function public.set_certificate_verification_enabled(
  p_certificate_id uuid,
  p_enabled boolean
)
returns void
language sql
security invoker
set search_path = pg_catalog, app
as $$
  select app.set_certificate_verification_enabled(p_certificate_id, p_enabled);
$$;

revoke all on function public.duplicate_certificate_with_skill_snapshot(uuid) from public, anon, authenticated, service_role;
revoke all on function public.reissue_certificate(uuid, text, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.revoke_certificate(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.update_certificate_metadata(uuid, date, text) from public, anon, authenticated, service_role;
revoke all on function public.set_certificate_deleted(uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function public.set_certificate_verification_enabled(uuid, boolean) from public, anon, authenticated, service_role;

grant execute on function public.duplicate_certificate_with_skill_snapshot(uuid) to authenticated;
grant execute on function public.reissue_certificate(uuid, text, text, jsonb) to authenticated;
grant execute on function public.revoke_certificate(uuid, text) to authenticated;
grant execute on function public.update_certificate_metadata(uuid, date, text) to authenticated;
grant execute on function public.set_certificate_deleted(uuid, boolean) to authenticated;
grant execute on function public.set_certificate_verification_enabled(uuid, boolean) to authenticated;

DO $wrapper_postconditions$
DECLARE
  v_fn text;
  v_oid oid;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.issue_certificate_with_skill_snapshot(uuid,uuid,text)',
    'public.duplicate_certificate_with_skill_snapshot(uuid)',
    'public.reissue_certificate(uuid,text,text,jsonb)',
    'public.revoke_certificate(uuid,text)',
    'public.update_certificate_metadata(uuid,date,text)',
    'public.set_certificate_deleted(uuid,boolean)',
    'public.set_certificate_verification_enabled(uuid,boolean)'
  ] LOOP
    v_oid := to_regprocedure(v_fn);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'I3B postcondition failed: lifecycle wrapper is missing: %',v_fn;
    END IF;
    IF (SELECT pg_catalog.pg_get_userbyid(p.proowner) FROM pg_catalog.pg_proc p WHERE p.oid=v_oid)<>'postgres'
       OR (SELECT p.proconfig FROM pg_catalog.pg_proc p WHERE p.oid=v_oid) IS DISTINCT FROM ARRAY['search_path=pg_catalog, app']::text[] THEN
      RAISE EXCEPTION 'I3B postcondition failed: lifecycle wrapper owner/search_path is incorrect: %',v_fn;
    END IF;
    IF v_fn<>'public.issue_certificate_with_skill_snapshot(uuid,uuid,text)'
       AND (SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid=v_oid) THEN
      RAISE EXCEPTION 'I3B postcondition failed: lifecycle wrapper must remain SECURITY INVOKER: %',v_fn;
    END IF;
    IF NOT pg_catalog.has_function_privilege('authenticated',v_oid,'EXECUTE')
       OR pg_catalog.has_function_privilege('anon',v_oid,'EXECUTE')
       OR pg_catalog.has_function_privilege('service_role',v_oid,'EXECUTE')
       OR EXISTS (
         SELECT 1
         FROM pg_catalog.pg_proc p
         CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
         WHERE p.oid=v_oid AND a.grantee=0 AND a.privilege_type='EXECUTE'
       ) THEN
      RAISE EXCEPTION 'I3B postcondition failed: lifecycle wrapper EXECUTE ACL is incorrect: %',v_fn;
    END IF;
  END LOOP;
END
$wrapper_postconditions$;

COMMIT;
