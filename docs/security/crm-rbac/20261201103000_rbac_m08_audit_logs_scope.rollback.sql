-- ROLLBACK for 20261201103000_rbac_m08_audit_logs_scope.sql (local design artefact; separate Owner approval required to run anywhere).
-- Re-creates the previous policies verbatim (captured from the Production-equivalent fixture, 2026-11-24).
set local lock_timeout = '5s';
drop policy if exists audit_staff_read on public.audit_logs;
create policy audit_staff_read on public.audit_logs as permissive for select to authenticated
  using ((app.is_admin() AND ( SELECT app.has_any_module_access(ARRAY['audit'::text, 'automation'::text, 'backups'::text, 'reports'::text], 'view'::text) AS has_any_module_access)));
