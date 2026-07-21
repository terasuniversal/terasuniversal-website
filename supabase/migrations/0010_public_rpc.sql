-- =====================================================================
-- TERAS UNIVERSAL Admin CMS
-- Migration 0010 — Public RPC wrappers
-- =====================================================================
-- PostgREST (the Supabase REST/RPC layer) exposes the `public` schema only.
-- Our helper functions live in `app`, so we expose thin public wrappers for
-- the two that the application calls via supabase.rpc().
-- =====================================================================

create or replace function public.log_event(
  p_action      audit_action,
  p_entity_type text default null,
  p_entity_id   text default null,
  p_summary     text default null,
  p_metadata    jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = public
as $$
  select app.log_event(p_action, p_entity_type, p_entity_id, p_summary, p_metadata);
$$;

create or replace function public.global_search(q text, max_rows int default 20)
returns table (entity_type text, entity_id uuid, title text, subtitle text, rank real)
language sql
stable
security definer
set search_path = public
as $$
  select * from app.global_search(q, max_rows);
$$;

grant execute on function public.log_event(audit_action, text, text, text, jsonb) to authenticated;
grant execute on function public.global_search(text, int) to authenticated;
