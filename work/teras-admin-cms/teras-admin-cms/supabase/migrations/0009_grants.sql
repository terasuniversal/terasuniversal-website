-- =====================================================================
-- TERAS UNIVERSAL Admin CMS
-- Migration 0009 — Role Grants (privilege layer)
-- =====================================================================
-- RLS decides WHICH ROWS a role can touch; SQL GRANTs decide whether the
-- role can touch the table AT ALL. Supabase's API roles (anon,
-- authenticated) need explicit table privileges — RLS then filters rows.
--
-- Strategy:
--   anon          → USAGE on schema; SELECT on all tables (RLS filters to
--                   published rows); INSERT only on the two public forms.
--   authenticated → full DML on all tables (RLS filters by role);
--                   EXECUTE on the public-facing RPCs.
--   service_role  → bypasses RLS (Supabase default); used only by trusted
--                   server code, never exposed to the browser.
-- =====================================================================

grant usage on schema public to anon, authenticated;
grant usage on schema app to anon, authenticated;

-- Read access for everyone; RLS restricts anon to published/live rows.
grant select on all tables in schema public to anon, authenticated;

-- Authenticated staff get write access; RLS restricts by role (editor/admin).
grant insert, update, delete on all tables in schema public to authenticated;

-- Public website forms: anon may INSERT only into these two inbound tables.
grant insert on public.enquiries to anon;
grant insert on public.proposal_requests to anon;

-- Identity/serial sequences (audit_logs uses IDENTITY; grant for safety).
grant usage, select on all sequences in schema public to authenticated;

-- Public-facing RPCs.
grant execute on function app.global_search(text, int) to authenticated;
grant execute on function app.log_event(audit_action, text, text, text, jsonb) to authenticated;

-- Ensure future tables created in public inherit sensible defaults so a new
-- migration doesn't silently lock out the API roles.
alter default privileges in schema public grant select on tables to anon, authenticated;
alter default privileges in schema public grant insert, update, delete on tables to authenticated;
alter default privileges in schema public grant usage, select on sequences to authenticated;
