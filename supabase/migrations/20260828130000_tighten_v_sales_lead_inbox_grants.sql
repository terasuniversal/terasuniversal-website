-- TERAS UNIVERSAL — Tighten public.v_sales_lead_inbox authenticated grants
-- (belt-and-suspenders privilege correction, split out of
-- 20260814120000_create_sales_crm_v1.sql per CLAUDE.md §11 rule 6 / general
-- migration hygiene — that file has already been applied to both staging
-- and production, so its content must not be edited after the fact; this
-- fix is filed as its own migration instead).
--
-- Context: this project's Supabase default privileges can auto-grant new
-- relations (views included) broader authenticated access than the
-- explicit GRANT a migration writes for them. The view is not actually
-- updatable (LEFT JOINs + CASE expressions), so any such extra grant would
-- be inert in practice, but this tightens it to match the least-privilege
-- pattern already used for enquiries/proposal_requests/sales_lead_metadata.
--
-- Ordering: timestamped to run AFTER 20260828120000_promote_marketing_
-- contact_to_sales.sql, which already re-creates public.v_sales_lead_inbox
-- (via drop + create, since CREATE OR REPLACE VIEW cannot reorder existing
-- columns — see that file's header) and already issues this exact REVOKE as
-- part of restoring the view's grants post-drop. On any environment where
-- 20260828120000 has already run, the REVOKE below is a pure no-op
-- (revoking a privilege that is not held is not an error in Postgres). This
-- file exists as an explicit, independent safety net so the tightened grant
-- is guaranteed regardless of whether 20260828120000 has been applied yet,
-- and is not lost if that migration is ever reverted on its own.
--
-- Safety: single REVOKE statement, guarded to be a no-op if the view does
-- not exist on a given environment (rather than erroring) — no DDL on the
-- view's columns/definition, no RLS/table change, no data mutation. Safe to
-- apply to staging and production regardless of whether 20260828120000 has
-- run there yet.
do $$
begin
  if to_regclass('public.v_sales_lead_inbox') is not null then
    revoke insert, update, delete, truncate, references, trigger
      on public.v_sales_lead_inbox
      from authenticated;
  end if;
end
$$;
