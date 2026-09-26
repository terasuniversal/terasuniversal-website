-- Keep the pre-existing issuance API wrapper equally narrow and explicitly
-- exclude anon/service_role. Its business logic remains in app.*.
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
