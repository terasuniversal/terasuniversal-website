-- C3D: Close ordinary authenticated writes to certificate skill history.
-- Forward-only privilege/policy hardening; preserves existing rows and
-- SECURITY DEFINER issuance/duplicate RPC writers.

begin;

revoke insert, update, delete, truncate, references, trigger
  on public.certificate_skill_results from authenticated;
drop policy if exists certificate_skill_results_insert on public.certificate_skill_results;

comment on table public.certificate_skill_results is
  'Immutable certificate skill history. Normal authenticated clients have read-only access; controlled issuance and duplicate SECURITY DEFINER RPCs are the only application writers.';

commit;
