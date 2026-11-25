-- ROLLBACK for 20261201102000_rbac_m07_participants_select_minimum.sql (local design artefact; separate Owner approval required to run anywhere).
-- Re-creates the previous policies verbatim (captured from the Production-equivalent fixture, 2026-11-24).
set local lock_timeout = '5s';
drop policy if exists participants_select on public.participants;
create policy participants_select on public.participants as permissive for select to authenticated
  using (app.has_min_role('editor'::user_role));

drop function if exists public.get_report_participants(integer);
drop function if exists public.get_report_participant_count();
