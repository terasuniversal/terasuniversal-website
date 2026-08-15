-- Contact lead capture upgrade: the public ContactForm/ContactEnquiryForm
-- components currently only open a mailto: link and persist nothing (see
-- BUG_REPORT-adjacent finding, prior audit session). This migration adds
-- real server-side persistence.
--
-- `enquiries` does NOT exist in the live database today (confirmed via
-- information_schema.columns before writing this file) -- it only appears
-- in the numbered/never-applied migration track referenced by
-- DELIVERABLE.md. This is a fresh table on the live/compatibility track,
-- not a resurrection of that design.
--
-- Access model, matching the existing public.get_public_upcoming_schedules /
-- public.verify_and_log precedent (CLAUDE.md §6: "prefer narrow SECURITY
-- DEFINER RPC ... explicit anon/authenticated grants"):
--   - No RLS policy grants anon or authenticated any direct INSERT/UPDATE/
--     DELETE on the table at all. The public write path is exclusively the
--     submit_public_enquiry() RPC below.
--   - Staff (editor+) get read-only SELECT via the standard app.has_min_role()
--     helper, consistent with every other staff-facing table, so a future
--     admin UI (out of scope for this change) can list enquiries without a
--     further RLS change.
--   - No admin UI, MODULE_ACCESS entry, or audit trigger is added here --
--     there is no staff-driven mutation path yet for this table (the only
--     writer is the public RPC, which has no authenticated actor to
--     attribute an audit-trigger row to). Add these in the same change that
--     adds admin CRUD for enquiries.
--
-- Idempotent: safe to re-run.

create table if not exists public.enquiries (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  company text check (company is null or char_length(company) <= 160),
  email text not null check (char_length(email) between 3 and 254),
  phone text not null check (char_length(phone) between 1 and 40),
  enquiry_type text not null check (enquiry_type in ('Corporate', 'Individual', 'Government', 'Training')),
  subject text not null check (char_length(subject) between 1 and 160),
  message text not null check (char_length(message) between 1 and 3000),
  source_page text not null check (source_page in ('homepage', 'contact_page')),
  status text not null default 'new' check (status in ('new', 'contacted', 'closed')),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists enquiries_created_at_idx on public.enquiries (created_at desc);
create index if not exists enquiries_email_created_at_idx on public.enquiries (email, created_at desc);

alter table public.enquiries enable row level security;

drop policy if exists enquiries_select on public.enquiries;
create policy enquiries_select on public.enquiries
  for select to authenticated
  using (app.has_min_role('editor'::public.user_role));

-- Belt-and-suspenders: this project's default privileges grant new tables
-- broad anon/authenticated GRANTs regardless of RLS. RLS already blocks
-- anon (no anon-scoped policy exists above) and blocks authenticated beyond
-- SELECT, but match the explicit least-privilege GRANT pattern already used
-- by courses/course_schedules instead of relying on RLS alone.
revoke all on public.enquiries from anon;
revoke insert, update, delete, truncate, references, trigger on public.enquiries from authenticated;

-- No insert/update/delete policy for any role: every write goes through the
-- SECURITY DEFINER RPC below, which bypasses RLS internally.

create or replace function public.submit_public_enquiry(
  p_name text,
  p_company text,
  p_email text,
  p_phone text,
  p_enquiry_type text,
  p_subject text,
  p_message text,
  p_source_page text
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
  if p_enquiry_type not in ('Corporate', 'Individual', 'Government', 'Training') then
    raise exception 'invalid_enquiry_type' using errcode = 'P0001';
  end if;
  if p_source_page not in ('homepage', 'contact_page') then
    raise exception 'invalid_source_page' using errcode = 'P0001';
  end if;

  -- Multi-instance-safe rate limit: Postgres itself is the shared store, so
  -- unlike an in-memory Map (flagged as unsafe for this app's serverless
  -- deployment -- CLAUDE.md §7) this holds across concurrent server
  -- instances. One submission per email per 60 seconds.
  if exists (
    select 1 from public.enquiries
    where email = lower(trim(p_email))
      and created_at > now() - interval '60 seconds'
  ) then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  insert into public.enquiries (name, company, email, phone, enquiry_type, subject, message, source_page)
  values (
    trim(p_name),
    nullif(trim(coalesce(p_company, '')), ''),
    lower(trim(p_email)),
    trim(p_phone),
    p_enquiry_type,
    trim(p_subject),
    trim(p_message),
    p_source_page
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.submit_public_enquiry(text, text, text, text, text, text, text, text) from public;
grant execute on function public.submit_public_enquiry(text, text, text, text, text, text, text, text) to anon, authenticated;
