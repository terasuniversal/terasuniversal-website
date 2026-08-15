-- =====================================================================
-- TERAS UNIVERSAL Admin CMS
-- Migration 0005 — Audit Log
-- =====================================================================
-- Append-only record of privileged activity. Written by the generic
-- trigger in migration 0006 for content tables, and directly by the app
-- for auth events (login/logout/export).
-- =====================================================================

create table if not exists public.audit_logs (
  id           bigint generated always as identity primary key,
  actor_id     uuid references public.profiles (id) on delete set null,
  actor_email  text,                         -- snapshotted so the log survives user deletion
  action       audit_action not null,
  entity_type  text,                         -- 'courses', 'schedules', 'auth', ...
  entity_id    text,                         -- uuid or other identifier as text
  summary      text,
  metadata     jsonb not null default '{}'::jsonb,
  ip_address   inet,
  created_at   timestamptz not null default now()
);

create index if not exists idx_audit_actor on public.audit_logs (actor_id);
create index if not exists idx_audit_entity on public.audit_logs (entity_type, entity_id);
create index if not exists idx_audit_action on public.audit_logs (action);
create index if not exists idx_audit_created on public.audit_logs (created_at desc);

comment on table public.audit_logs is 'Append-only audit trail. No UPDATE/DELETE permitted via RLS.';

-- Helper the application layer calls for non-table events (login, export).
create or replace function app.log_event(
  p_action     audit_action,
  p_entity_type text default null,
  p_entity_id   text default null,
  p_summary     text default null,
  p_metadata    jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  select email into v_email from public.profiles where id = auth.uid();
  insert into public.audit_logs (actor_id, actor_email, action, entity_type, entity_id, summary, metadata)
  values (auth.uid(), v_email, p_action, p_entity_type, p_entity_id, p_summary, coalesce(p_metadata, '{}'::jsonb));
end;
$$;
