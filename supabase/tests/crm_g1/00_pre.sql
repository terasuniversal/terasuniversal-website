\set ON_ERROR_STOP on
-- G1 additions to the P2 fixture: the live audit_action has 'create' (used by record_manual_payment), and Supabase grants
-- EXECUTE on new public functions to anon/authenticated/service_role by default, so the G1 revokes are tested against that.
alter type public.audit_action add value if not exists 'create';
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
