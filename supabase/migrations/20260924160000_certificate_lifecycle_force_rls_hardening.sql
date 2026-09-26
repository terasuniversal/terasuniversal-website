-- I3A: narrowly grant the SECURITY DEFINER lifecycle owner the RLS policies
-- required for issuance and append-only reprint/reissue events.
-- Preserve FORCE RLS and the existing authenticated module-scoped read policies.
-- Apply only after 20260924150000_certificate_c5b1_security_drift_hardening.sql.

begin;

-- The app issue RPC is owned by postgres and independently checks active admin
-- plus certificates-module admin access. Under FORCE RLS, its owner needs an
-- explicit SELECT policy for the single branch row selected by that RPC.
drop policy if exists certificate_branches_lifecycle_rpc_read
  on public.certificate_branches;
create policy certificate_branches_lifecycle_rpc_read
  on public.certificate_branches
  for select to postgres
  using (
    app.is_active()
    and app.is_admin()
    and public.has_module_access_level('certificates', 'admin')
  );

-- Only the SECURITY DEFINER owner can reach this INSERT policy. Bind the row
-- to the authenticated actor in the immutable snapshot itself; direct
-- authenticated/anonymous INSERT privileges remain revoked.
drop policy if exists certificate_issuance_snapshots_lifecycle_rpc_insert
  on public.certificate_issuance_snapshots;
create policy certificate_issuance_snapshots_lifecycle_rpc_insert
  on public.certificate_issuance_snapshots
  for insert to postgres
  with check (
    app.is_active()
    and app.is_admin()
    and public.has_module_access_level('certificates', 'admin')
    and created_by = auth.uid()
  );

-- Reprint/reissue uses the same guarded RPC and appends an event. The event
-- actor must be the current authenticated module administrator. The RPC uses
-- INSERT ... RETURNING, which also needs SELECT visibility for that returned
-- actor-owned row under FORCE RLS.
drop policy if exists certificate_reissue_events_lifecycle_rpc_read
  on public.certificate_reissue_events;
create policy certificate_reissue_events_lifecycle_rpc_read
  on public.certificate_reissue_events
  for select to postgres
  using (
    app.is_active()
    and app.is_admin()
    and public.has_module_access_level('certificates', 'admin')
    and reissued_by = auth.uid()
  );

drop policy if exists certificate_reissue_events_lifecycle_rpc_insert
  on public.certificate_reissue_events;
create policy certificate_reissue_events_lifecycle_rpc_insert
  on public.certificate_reissue_events
  for insert to postgres
  with check (
    app.is_active()
    and app.is_admin()
    and public.has_module_access_level('certificates', 'admin')
    and reissued_by = auth.uid()
  );

commit;
