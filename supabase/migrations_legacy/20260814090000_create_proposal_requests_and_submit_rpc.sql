-- Request Proposal CRM persistence fix.
--
-- Root cause of the production bug ("Your emails were sent, but we could
-- not record the request in our CRM"): app/api/request-proposal/route.js's
-- ONLY persistence mechanism was an external Google Sheets Apps Script
-- webapp (saveLeadToGoogleSheets), called AFTER both Resend emails had
-- already been sent. There has never been a Supabase table backing proposal
-- requests -- confirmed via information_schema.columns (zero rows for
-- table_name = 'proposal_requests') before writing this migration. When
-- GOOGLE_SHEETS_WEB_APP_URL is unset/misconfigured in a given Vercel
-- environment (e.g. Preview, which does not automatically inherit
-- Production env vars), saveLeadToGoogleSheets() throws, the outer catch
-- reports it as the user-facing error, and -- critically -- the lead is
-- lost entirely: nothing durable was ever recorded anywhere.
--
-- lib/supabase/database.types.ts already hand-declares a `ProposalRequest`
-- interface (company_name, contact_person, job_title, email, phone,
-- industry, category, programme, participants, location, preferred_month,
-- budget, objectives, notes, status, assigned_to, timestamps) and a
-- `ProposalStatus` enum (new/in_review/assigned/quoted/won/lost/archived)
-- that were never backed by a live table -- this migration finally
-- realizes that pre-existing intended design (CLAUDE.md's own "prefer the
-- existing intended architecture" principle) rather than reusing the
-- differently-shaped public.enquiries table (name/subject/message -- built
-- for the generic contact form, would lose industry/programme/participants/
-- budget/preferred_month fidelity if reused here).
--
-- Access model matches public.enquiries / submit_public_enquiry exactly:
-- no direct anon/authenticated table grants, staff SELECT via
-- app.has_min_role(), and a single narrow SECURITY DEFINER RPC as the only
-- public write path.
--
-- Idempotent: safe to re-run.

create table if not exists public.proposal_requests (
  id uuid primary key default gen_random_uuid(),
  company_name text not null check (char_length(company_name) between 1 and 160),
  contact_person text not null check (char_length(contact_person) between 1 and 120),
  job_title text check (job_title is null or char_length(job_title) <= 120),
  email text not null check (char_length(email) between 3 and 254),
  phone text not null check (char_length(phone) between 1 and 40),
  industry text not null check (industry in ('Oil & Gas', 'Petrochemical', 'Construction', 'Manufacturing', 'Marine & Offshore', 'Power & Utilities', 'Government & GLC', 'Others')),
  category text not null check (category in ('Industrial Safety', 'Technical Competency', 'Industrial Consultancy', 'Workforce Development')),
  programme text check (programme is null or char_length(programme) <= 160),
  participants integer check (participants is null or (participants >= 1 and participants <= 1000000)),
  location text check (location is null or char_length(location) <= 160),
  preferred_month text check (preferred_month is null or char_length(preferred_month) <= 7),
  budget text check (budget is null or char_length(budget) <= 80),
  objectives text not null check (char_length(objectives) between 1 and 3000),
  notes text check (notes is null or char_length(notes) <= 3000),
  status text not null default 'new' check (status in ('new', 'in_review', 'assigned', 'quoted', 'won', 'lost', 'archived')),
  assigned_to uuid references public.profiles(id),
  email_sent boolean not null default false,
  sheets_synced boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists proposal_requests_created_at_idx on public.proposal_requests (created_at desc);
create index if not exists proposal_requests_email_created_at_idx on public.proposal_requests (email, created_at desc);

alter table public.proposal_requests enable row level security;

drop policy if exists proposal_requests_select on public.proposal_requests;
create policy proposal_requests_select on public.proposal_requests
  for select to authenticated
  using (app.has_min_role('editor'::public.user_role));

drop policy if exists proposal_requests_update on public.proposal_requests;
create policy proposal_requests_update on public.proposal_requests
  for update to authenticated
  using (app.has_min_role('editor'::public.user_role))
  with check (app.has_min_role('editor'::public.user_role));

-- Match the least-privilege GRANT pattern already established for
-- enquiries: this project's default privileges otherwise auto-grant new
-- tables broad anon/authenticated access regardless of RLS.
revoke all on public.proposal_requests from anon;
revoke insert, delete, truncate, references, trigger on public.proposal_requests from authenticated;

create or replace function public.submit_proposal_request(
  p_company_name text,
  p_contact_person text,
  p_job_title text,
  p_email text,
  p_phone text,
  p_industry text,
  p_category text,
  p_programme text,
  p_participants integer,
  p_location text,
  p_preferred_month text,
  p_budget text,
  p_objectives text,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_id uuid;
begin
  if p_email is null or p_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception 'invalid_email' using errcode = 'P0001';
  end if;
  if p_industry not in ('Oil & Gas', 'Petrochemical', 'Construction', 'Manufacturing', 'Marine & Offshore', 'Power & Utilities', 'Government & GLC', 'Others') then
    raise exception 'invalid_industry' using errcode = 'P0001';
  end if;
  if p_category not in ('Industrial Safety', 'Technical Competency', 'Industrial Consultancy', 'Workforce Development') then
    raise exception 'invalid_category' using errcode = 'P0001';
  end if;

  -- Multi-instance-safe duplicate guard (Postgres is the shared store,
  -- unlike the in-memory Map the previous implementation used -- see
  -- CLAUDE.md §7). One submission per email per 60 seconds.
  if exists (
    select 1 from public.proposal_requests
    where email = lower(trim(p_email))
      and created_at > now() - interval '60 seconds'
  ) then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  insert into public.proposal_requests (
    company_name, contact_person, job_title, email, phone, industry, category,
    programme, participants, location, preferred_month, budget, objectives, notes
  )
  values (
    trim(p_company_name),
    trim(p_contact_person),
    nullif(trim(coalesce(p_job_title, '')), ''),
    lower(trim(p_email)),
    trim(p_phone),
    p_industry,
    p_category,
    nullif(trim(coalesce(p_programme, '')), ''),
    p_participants,
    nullif(trim(coalesce(p_location, '')), ''),
    nullif(trim(coalesce(p_preferred_month, '')), ''),
    nullif(trim(coalesce(p_budget, '')), ''),
    trim(p_objectives),
    nullif(trim(coalesce(p_notes, '')), '')
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.submit_proposal_request(text, text, text, text, text, text, text, text, integer, text, text, text, text, text) from public;
grant execute on function public.submit_proposal_request(text, text, text, text, text, text, text, text, integer, text, text, text, text, text) to anon, authenticated;

-- Lets the route record delivery outcome (email/Sheets) after the fact
-- without granting UPDATE on the base table to anon -- SECURITY DEFINER,
-- scoped to exactly the two delivery-status columns.
create or replace function public.mark_proposal_delivery_status(
  p_id uuid,
  p_email_sent boolean,
  p_sheets_synced boolean
)
returns void
language sql
security definer
set search_path = 'public'
as $$
  -- Scoped to rows created in the last 10 minutes: email_sent/sheets_synced
  -- are informational ops-tracking fields, not security-relevant, and UUIDs
  -- aren't practically guessable -- but this bounds the blast radius of this
  -- anon-callable RPC to "this request's own just-created row" rather than
  -- "any row ever, if the id were somehow known".
  update public.proposal_requests
  set email_sent = p_email_sent,
      sheets_synced = p_sheets_synced,
      updated_at = now()
  where id = p_id
    and created_at > now() - interval '10 minutes';
$$;

revoke all on function public.mark_proposal_delivery_status(uuid, boolean, boolean) from public;
grant execute on function public.mark_proposal_delivery_status(uuid, boolean, boolean) to anon, authenticated;
