-- Sales CRM V1: shared metadata + activity timeline over the existing
-- public.enquiries / public.proposal_requests source tables.
--
-- Per the task's explicit instruction, these two tables remain the source
-- of truth and are NOT duplicated. A polymorphic metadata table
-- (lead_source, source_id) carries everything a lead needs that neither
-- source table has (pipeline status, assignment, follow-up, priority,
-- won/lost outcome), and a separate append-only activity table backs the
-- timeline -- matching lib/sales/types.ts's pre-existing SalesActivity
-- shape (already designed, never wired to a database) rather than
-- inventing a new activity model.
--
-- Auto-creation: an AFTER INSERT trigger on each source table creates the
-- matching sales_lead_metadata row (status='new') and a 'lead_created'
-- activity entry the moment a public enquiry/proposal is captured, so the
-- CRM never has an orphaned source row with no metadata and the Dashboard's
-- "New Leads" count is correct without any staff action. Both trigger
-- functions run SECURITY DEFINER (like submit_public_enquiry itself, whose
-- INSERT is what fires them) so this works regardless of the inserting
-- role's own grants.
--
-- Access model: SELECT on both tables requires editor+ (matches every
-- other staff-facing table in this schema). UPDATE on sales_lead_metadata
-- (status/assignment/follow-up/priority/outcome) requires admin+, per the
-- task's explicit RLS suggestion and matching the existing participants
-- table's identical view=editor/mutate=admin split. sales_activity INSERT
-- is editor+ (adding a note or logging activity doesn't change a lead's
-- pipeline disposition, so it doesn't need the higher bar) but has no
-- UPDATE/DELETE policy for anyone -- append-only by design, per the task's
-- explicit "prefer append-only activity history" instruction.
--
-- Idempotent: safe to re-run.

create table if not exists public.sales_lead_metadata (
  id uuid primary key default gen_random_uuid(),
  lead_source text not null check (lead_source in ('enquiry', 'proposal_request')),
  source_id uuid not null,
  status text not null default 'new' check (status in ('new', 'contacted', 'qualified', 'proposal_sent', 'negotiation', 'won', 'lost', 'archived')),
  assigned_to uuid references public.profiles(id),
  follow_up_at timestamptz,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  lost_reason text check (lost_reason is null or lost_reason in ('price', 'no_budget', 'no_response', 'timing', 'competitor', 'requirement_changed', 'duplicate', 'other')),
  won_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lead_source, source_id)
);

create index if not exists sales_lead_metadata_status_idx on public.sales_lead_metadata (status);
create index if not exists sales_lead_metadata_assigned_to_idx on public.sales_lead_metadata (assigned_to);
create index if not exists sales_lead_metadata_follow_up_at_idx on public.sales_lead_metadata (follow_up_at);
create index if not exists sales_lead_metadata_created_at_idx on public.sales_lead_metadata (created_at desc);

alter table public.sales_lead_metadata enable row level security;

drop policy if exists sales_lead_metadata_select on public.sales_lead_metadata;
create policy sales_lead_metadata_select on public.sales_lead_metadata
  for select to authenticated
  using (app.has_min_role('editor'::public.user_role));

drop policy if exists sales_lead_metadata_update on public.sales_lead_metadata;
create policy sales_lead_metadata_update on public.sales_lead_metadata
  for update to authenticated
  using (app.is_admin())
  with check (app.is_admin());

-- No INSERT/DELETE policy for any role: rows are created exclusively by the
-- triggers below (running SECURITY DEFINER) and never deleted.
revoke all on public.sales_lead_metadata from anon;
revoke insert, delete, truncate, references, trigger on public.sales_lead_metadata from authenticated;

create table if not exists public.sales_activity (
  id uuid primary key default gen_random_uuid(),
  lead_metadata_id uuid not null references public.sales_lead_metadata(id) on delete cascade,
  type text not null check (type in ('lead_created', 'status_changed', 'assigned', 'followup_scheduled', 'note_added', 'proposal_sent', 'won', 'lost')),
  note text check (note is null or char_length(note) <= 3000),
  actor_id uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists sales_activity_lead_metadata_id_idx on public.sales_activity (lead_metadata_id, created_at desc);

alter table public.sales_activity enable row level security;

drop policy if exists sales_activity_select on public.sales_activity;
create policy sales_activity_select on public.sales_activity
  for select to authenticated
  using (app.has_min_role('editor'::public.user_role));

drop policy if exists sales_activity_insert on public.sales_activity;
create policy sales_activity_insert on public.sales_activity
  for insert to authenticated
  with check (app.has_min_role('editor'::public.user_role));

-- Append-only: no update/delete policy for anyone.
revoke all on public.sales_activity from anon;
revoke update, delete, truncate, references, trigger on public.sales_activity from authenticated;

create or replace function app.create_sales_lead_metadata()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_source text;
  v_metadata_id uuid;
begin
  v_source := case TG_TABLE_NAME
    when 'enquiries' then 'enquiry'
    when 'proposal_requests' then 'proposal_request'
  end;

  insert into public.sales_lead_metadata (lead_source, source_id, status)
  values (v_source, NEW.id, 'new')
  on conflict (lead_source, source_id) do nothing
  returning id into v_metadata_id;

  if v_metadata_id is not null then
    insert into public.sales_activity (lead_metadata_id, type, note)
    values (v_metadata_id, 'lead_created', 'Lead captured from ' || v_source || ' submission');
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_enquiries_create_sales_lead on public.enquiries;
create trigger trg_enquiries_create_sales_lead
  after insert on public.enquiries
  for each row execute function app.create_sales_lead_metadata();

drop trigger if exists trg_proposal_requests_create_sales_lead on public.proposal_requests;
create trigger trg_proposal_requests_create_sales_lead
  after insert on public.proposal_requests
  for each row execute function app.create_sales_lead_metadata();

-- Backfill: covers any source rows that predate this migration (none exist
-- live today, but keeps the migration correct/idempotent regardless).
insert into public.sales_lead_metadata (lead_source, source_id, status)
select 'enquiry', e.id, 'new'
from public.enquiries e
where not exists (
  select 1 from public.sales_lead_metadata m
  where m.lead_source = 'enquiry' and m.source_id = e.id
)
on conflict (lead_source, source_id) do nothing;

insert into public.sales_lead_metadata (lead_source, source_id, status)
select 'proposal_request', p.id, 'new'
from public.proposal_requests p
where not exists (
  select 1 from public.sales_lead_metadata m
  where m.lead_source = 'proposal_request' and m.source_id = p.id
)
on conflict (lead_source, source_id) do nothing;

-- Backfill's own "lead_created" activity entry — the trigger logs this for
-- every row it creates, but the two backfill INSERTs above (needed for any
-- source rows older than this migration) didn't, leaving those leads with
-- metadata but no activity trail. Confirmed live: a real enquiry submitted
-- shortly before this migration was applied ended up with exactly this gap.
insert into public.sales_activity (lead_metadata_id, type, note)
select m.id, 'lead_created', 'Lead captured from ' || m.lead_source || ' submission'
from public.sales_lead_metadata m
where not exists (
  select 1 from public.sales_activity a
  where a.lead_metadata_id = m.id and a.type = 'lead_created'
);

-- Unified read model for the Lead Inbox. security_invoker = true is
-- required (Postgres views default to running as the view owner otherwise)
-- so RLS on the underlying tables is enforced against the querying staff
-- member, not silently bypassed -- an editor with no sales_lead_metadata
-- access must not see rows through this view that direct table RLS would
-- deny them.
create or replace view public.v_sales_lead_inbox
with (security_invoker = true) as
select
  m.id as lead_metadata_id,
  m.lead_source,
  m.source_id,
  m.status,
  m.assigned_to,
  m.follow_up_at,
  m.priority,
  m.lost_reason,
  m.won_at,
  m.created_at,
  m.updated_at,
  case when m.lead_source = 'enquiry' then e.name else p.contact_person end as contact_name,
  case when m.lead_source = 'enquiry' then e.company else p.company_name end as company,
  case when m.lead_source = 'enquiry' then e.email else p.email end as email,
  case when m.lead_source = 'enquiry' then e.phone else p.phone end as phone,
  case when m.lead_source = 'enquiry' then e.subject else coalesce(p.programme, p.category) end as subject
from public.sales_lead_metadata m
left join public.enquiries e on m.lead_source = 'enquiry' and e.id = m.source_id
left join public.proposal_requests p on m.lead_source = 'proposal_request' and p.id = m.source_id;

revoke all on public.v_sales_lead_inbox from anon;
grant select on public.v_sales_lead_inbox to authenticated;
-- Belt-and-suspenders, found during a later production-readiness audit:
-- this project's default privileges auto-grant new relations (views
-- included) broad authenticated access regardless of the explicit GRANT
-- above. The view isn't actually updatable (LEFT JOINs + CASE expressions),
-- so these were inert, but tighten to match the least-privilege pattern
-- already used for enquiries/proposal_requests/sales_lead_metadata.
revoke insert, update, delete, truncate, references, trigger on public.v_sales_lead_inbox from authenticated;
