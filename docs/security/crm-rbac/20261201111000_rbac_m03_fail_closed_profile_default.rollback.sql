-- ROLLBACK for 20261201111000_rbac_m03_fail_closed_profile_default.sql (local design artefact; separate Owner approval).
-- Profiles created while the new default was active keep access_control_enabled = true (rows are never rewritten).
set local lock_timeout = '5s';
alter table public.profiles alter column access_control_enabled set default false;
