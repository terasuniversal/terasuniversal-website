-- Belt-and-suspenders, found during a later production-readiness audit:
-- this project's default privileges auto-grant new relations (views
-- included) broad authenticated access regardless of the explicit GRANT
-- in 20260814120000_create_sales_crm_v1.sql. The view isn't actually
-- updatable (LEFT JOINs + CASE expressions), so these were inert, but
-- tighten to match the least-privilege pattern already used for
-- enquiries/proposal_requests/sales_lead_metadata.
--
-- Applied as a new follow-up migration, not a rewrite of the historical
-- 20260814120000 migration, per migration discipline: that file stays
-- exactly as originally written/applied; this one records the correction.
--
-- Idempotent: safe to re-run (REVOKE on a grant that doesn't exist is a no-op).

revoke insert, update, delete, truncate, references, trigger on public.v_sales_lead_inbox from authenticated;
