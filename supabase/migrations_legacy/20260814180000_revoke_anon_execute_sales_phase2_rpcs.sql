-- Final production gate finding (Phase 2): the four Phase 2 cascade RPCs
-- (accept_quotation, convert_lead_to_opportunity, mark_opportunity_lost,
-- reject_quotation) were reachable by anon with direct EXECUTE, discovered
-- via a live information_schema.role_routine_grants audit.
--
-- 20260814150000_create_sales_crm_phase2_opportunities_quotations.sql
-- already contained `revoke all on function ... from public;` for each of
-- these, which SHOULD have been sufficient -- but this project's schema
-- also grants `anon` its own explicit, non-PUBLIC-inherited EXECUTE at
-- CREATE FUNCTION time (the same default-privileges behavior already
-- documented and worked around for tables/views in
-- 20260814060000_create_enquiries_and_submit_rpc.sql and
-- 20260814120000_create_sales_crm_v1.sql). Revoking from PUBLIC alone does
-- not remove a role's own separate explicit grant -- anon needed its own
-- explicit REVOKE, which this migration adds.
--
-- No privilege escalation was actually possible through this gap -- each
-- function's own `if not app.is_admin() then raise exception 'forbidden'`
-- guard would have rejected an anon caller regardless (anon has no
-- profiles row / no auth.uid()) -- but an anon-callable admin-only RPC is
-- unnecessary attack surface regardless of whether the internal guard
-- currently holds, and violates this task's explicit "no anon access"
-- requirement for Sales CRM Phase 2.
--
-- Applied as a NEW follow-up migration, not a silent live-only patch, per
-- migration discipline: the two prior Phase 2 migration files stay exactly
-- as originally written/applied; this one records the correction.
--
-- Idempotent: safe to re-run (REVOKE on a grant that doesn't exist is a no-op).

revoke execute on function public.accept_quotation(uuid) from anon;
revoke execute on function public.convert_lead_to_opportunity(uuid, text, date, numeric) from anon;
revoke execute on function public.mark_opportunity_lost(uuid, text) from anon;
revoke execute on function public.reject_quotation(uuid, text) from anon;
