-- ROLLBACK for 20261201101000_rbac_m06_invoice_items_select.sql (local design artefact; separate Owner approval required to run anywhere).
-- Re-creates the previous policies verbatim (captured from the Production-equivalent fixture, 2026-11-24).
set local lock_timeout = '5s';
drop policy if exists invoice_items_select on public.invoice_items;
create policy invoice_items_select on public.invoice_items as permissive for select to public
  using (app.has_min_role('editor'::user_role));
