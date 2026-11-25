-- ROLLBACK for 20261201110000_rbac_m02_can_module.sql (local design artefact; separate Owner approval required).
-- Only valid AFTER M-04 and M-05 have been rolled back (they reference app.can_module); DROP without CASCADE so it
-- fails loudly instead of silently removing dependent policies.
set local lock_timeout = '5s';
drop function if exists app.can_module(text, text);
