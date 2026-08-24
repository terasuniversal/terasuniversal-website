-- Supabase's Data API exposes the public schema to the server client. The
-- privileged issuance implementation remains in app, while this narrow
-- authenticated wrapper makes it callable through supabase.rpc(...).
-- app.issue_certificate_with_skill_snapshot independently requires an active
-- admin, so this wrapper cannot bypass certificate authorization.
create or replace function public.issue_certificate_with_skill_snapshot(
  p_schedule_id uuid,
  p_participant_id uuid,
  p_certificate_number text default null
)
returns table (id uuid, verification_token text)
language sql
security invoker
set search_path = public, app
as $$
  select *
  from app.issue_certificate_with_skill_snapshot(
    p_schedule_id,
    p_participant_id,
    p_certificate_number
  );
$$;

revoke all on function public.issue_certificate_with_skill_snapshot(uuid, uuid, text) from public;
grant execute on function public.issue_certificate_with_skill_snapshot(uuid, uuid, text) to authenticated;
