-- Marketing CRM Phase 1C — UTM fields for existing Sales Lead attribution.
-- HIGH-RISK / EDIT_ONLY_NO_APPLY until separately approved.
-- `source` remains the approved acquisition channel enum; this migration only
-- stores optional UTM campaign metadata on the existing one-to-one attribution
-- row. No Sales lead ownership or intake rule is changed.

alter table public.sales_lead_attributions
  add column if not exists utm_source text,
  add column if not exists utm_medium text,
  add column if not exists utm_campaign text,
  add column if not exists utm_content text,
  add column if not exists utm_term text;

create index if not exists sales_lead_attributions_utm_campaign_idx
  on public.sales_lead_attributions (utm_campaign)
  where utm_campaign is not null;

revoke all on public.sales_lead_attributions from anon;
grant select, insert, update on public.sales_lead_attributions to authenticated;
