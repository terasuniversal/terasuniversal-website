-- EDIT ONLY / DO NOT APPLY WITHOUT HUMAN APPROVAL.
-- Additive replacement for the retired pre-existing draft migration.
-- The live database owns public.marketing_campaigns, whose existing channel
-- field is used by the current Marketing contact flow; do not recreate or
-- rename that table.

alter table public.marketing_campaigns
  add column if not exists status text not null default 'draft',
  add column if not exists objective text,
  add column if not exists budget numeric(12,2),
  add column if not exists start_date date,
  add column if not exists end_date date,
  add column if not exists notes text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.marketing_campaigns'::regclass
      and conname = 'marketing_campaigns_dates_check'
  ) then
    alter table public.marketing_campaigns add constraint marketing_campaigns_dates_check
      check (end_date is null or start_date is null or end_date >= start_date);
  end if;
end $$;

create index if not exists marketing_campaigns_status_idx on public.marketing_campaigns(status);
create index if not exists marketing_campaigns_channel_idx on public.marketing_campaigns(channel);
create unique index if not exists marketing_campaigns_name_lower_uidx on public.marketing_campaigns(lower(name));

-- The campaign number default calls this existing SECURITY DEFINER helper.
-- Allow signed-in editors to insert campaigns without exposing the helper to anon.
revoke execute on function app.next_campaign_number() from public;
grant execute on function app.next_campaign_number() to authenticated;

alter table public.marketing_campaigns enable row level security;
drop policy if exists marketing_campaigns_select on public.marketing_campaigns;
create policy marketing_campaigns_select on public.marketing_campaigns for select to authenticated using (app.has_min_role('editor'::public.user_role));
drop policy if exists marketing_campaigns_insert on public.marketing_campaigns;
create policy marketing_campaigns_insert on public.marketing_campaigns for insert to authenticated with check (app.has_min_role('editor'::public.user_role));
drop policy if exists marketing_campaigns_update on public.marketing_campaigns;
create policy marketing_campaigns_update on public.marketing_campaigns for update to authenticated using (app.has_min_role('editor'::public.user_role)) with check (app.has_min_role('editor'::public.user_role));
revoke all on public.marketing_campaigns from anon;
grant select, insert, update on public.marketing_campaigns to authenticated;
revoke delete, truncate, references, trigger on public.marketing_campaigns from authenticated;
drop trigger if exists trg_marketing_campaigns_updated_at on public.marketing_campaigns;
create trigger trg_marketing_campaigns_updated_at before update on public.marketing_campaigns for each row execute function app.set_updated_at();
drop trigger if exists trg_marketing_campaigns_audit on public.marketing_campaigns;
create trigger trg_marketing_campaigns_audit after insert or update or delete on public.marketing_campaigns for each row execute function app.audit_trigger();

-- Marketing contacts already support source_campaign_id and promotion into
-- Sales. This table supplements, and does not replace, the inbound Sales ->
-- Leads flow when an existing Sales lead needs explicit attribution.
create table if not exists public.sales_lead_attributions (
  id uuid primary key default gen_random_uuid(),
  lead_metadata_id uuid not null unique references public.sales_lead_metadata(id) on delete cascade,
  source text not null check (source in ('facebook','tiktok','whatsapp','website','referral','other')),
  campaign_id uuid references public.marketing_campaigns(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sales_lead_attributions_campaign_idx on public.sales_lead_attributions(campaign_id);
create index if not exists sales_lead_attributions_source_idx on public.sales_lead_attributions(source);
alter table public.sales_lead_attributions enable row level security;
drop policy if exists sales_lead_attributions_select on public.sales_lead_attributions;
create policy sales_lead_attributions_select on public.sales_lead_attributions for select to authenticated using (app.has_min_role('editor'::public.user_role));
drop policy if exists sales_lead_attributions_insert on public.sales_lead_attributions;
create policy sales_lead_attributions_insert on public.sales_lead_attributions for insert to authenticated with check (app.has_min_role('editor'::public.user_role));
drop policy if exists sales_lead_attributions_update on public.sales_lead_attributions;
create policy sales_lead_attributions_update on public.sales_lead_attributions for update to authenticated using (app.has_min_role('editor'::public.user_role)) with check (app.has_min_role('editor'::public.user_role));
revoke all on public.sales_lead_attributions from anon;
grant select, insert, update on public.sales_lead_attributions to authenticated;
revoke delete, truncate, references, trigger on public.sales_lead_attributions from authenticated;
drop trigger if exists trg_sales_lead_attributions_updated_at on public.sales_lead_attributions;
create trigger trg_sales_lead_attributions_updated_at before update on public.sales_lead_attributions for each row execute function app.set_updated_at();
drop trigger if exists trg_sales_lead_attributions_audit on public.sales_lead_attributions;
create trigger trg_sales_lead_attributions_audit after insert or update or delete on public.sales_lead_attributions for each row execute function app.audit_trigger();
