-- ROLLBACK for 20261201100000_rbac_m01_h1_revoke_registration_payment_rpcs.sql (local design artefact; separate Owner
-- approval required to run anywhere). Restores the previous grantee set: authenticated + service_role.
-- Note: rolling back re-opens finding H1 (direct RPC access for every active admin).
set local lock_timeout = '5s';
grant execute on function public.verify_public_registration_manual_payment(text, text, numeric, text, text, uuid) to authenticated;
grant execute on function public.finalize_public_registration_crm(uuid) to authenticated;
