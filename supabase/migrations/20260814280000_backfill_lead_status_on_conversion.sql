-- Backfill for the Lead -> Opportunity status sync hotfix (companion to
-- 20260814270000, which fixes the RPC going forward).
--
-- NOT YET APPLIED TO THE LIVE DATABASE as of writing this file — this is a
-- data-modifying UPDATE against real production rows, and the task
-- explicitly requires reporting the count and exact rule before running
-- it, not applying it silently during audit. Apply only after explicit
-- confirmation.
--
-- Scope: exactly the leads that are *demonstrably* inconsistent — a real
-- sales_opportunities row already exists for them (proof they were
-- qualified enough to convert), but their own status is still stuck at a
-- pre-qualification value ('new' or 'contacted'). Leads already at
-- 'qualified' or any later state (proposal_sent/negotiation/won/lost/
-- archived) are explicitly excluded by the WHERE clause, so this can never
-- downgrade or overwrite a real later status.
--
-- Verified live before writing this file: exactly 1 row matches (the lead
-- behind OPP-2026-0010, status='new' despite its opportunity already being
-- at stage='quotation').
--
-- Idempotent: safe to re-run (a second run matches 0 rows, since the first
-- run already moved every matching lead to 'qualified').

update public.sales_lead_metadata
set status = 'qualified', updated_at = now()
where status in ('new', 'contacted')
  and exists (
    select 1 from public.sales_opportunities o where o.lead_metadata_id = sales_lead_metadata.id
  );
