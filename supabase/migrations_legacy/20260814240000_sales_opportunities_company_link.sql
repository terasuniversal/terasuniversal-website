-- Sales CRM Phase 4A — Won Opportunity -> Company linking.
--
-- Real FK relationship rather than duplicating the Company record into
-- Sales: sales_opportunities keeps its own free-text company_name/contact_*
-- snapshot (unchanged, still useful once linked as "what Sales was told"),
-- and company_id is the authoritative link once staff confirm it, set only
-- via linkCompany()/createCompany()'s handoff path in
-- app/admin/(protected)/sales/opportunities/actions.ts -- never inferred or
-- auto-set anywhere else.
--
-- Nullable, on delete set null (not cascade): deleting a Company must never
-- delete or corrupt Sales history.
--
-- Idempotent: safe to re-run.

alter table public.sales_opportunities
  add column if not exists company_id uuid references public.companies(id) on delete set null;

-- Covering index for the new FK column (CLAUDE.md §13 -- Postgres does not
-- auto-index FK columns). Partial: only rows that are actually linked need
-- the index; unlinked rows (the majority pre-Phase-4A) don't.
create index if not exists sales_opportunities_company_id_idx
  on public.sales_opportunities (company_id)
  where company_id is not null;

comment on column public.sales_opportunities.company_id is
  'Confirmed link to the canonical companies record, set only via explicit staff confirmation (Link Existing Company / Create Company on a Won Opportunity). Null until linked.';

-- sales_activity.type CHECK extended additively (same pattern as
-- 20260814220000): two new event types for the company-linking flow.
alter table public.sales_activity drop constraint if exists sales_activity_type_check;
alter table public.sales_activity add constraint sales_activity_type_check
  check (type = any (array[
    'lead_created', 'status_changed', 'assigned', 'followup_scheduled', 'note_added',
    'proposal_sent', 'won', 'lost', 'opportunity_created', 'quotation_created',
    'quotation_sent', 'quotation_revised', 'quotation_accepted', 'quotation_rejected',
    'opportunity_won', 'opportunity_lost', 'training_handoff_created',
    'company_linked', 'company_created'
  ]));
