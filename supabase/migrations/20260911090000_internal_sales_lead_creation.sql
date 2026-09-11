-- Internal Sales Lead creation over the existing polymorphic Lead pipeline.
-- This adds a source payload table; it does not create a second Lead system.

create table if not exists public.sales_internal_lead_sources (
  id uuid primary key default gen_random_uuid(),
  contact_name text not null check (char_length(trim(contact_name)) between 1 and 120),
  email text,
  phone text,
  company_name text,
  course_interest text,
  notes text,
  created_by uuid not null references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (email is not null or phone is not null),
  check (email is null or char_length(trim(email)) between 3 and 254),
  check (phone is null or char_length(trim(phone)) between 1 and 40),
  check (company_name is null or char_length(trim(company_name)) <= 160),
  check (course_interest is null or char_length(trim(course_interest)) <= 160),
  check (notes is null or char_length(trim(notes)) <= 3000)
);

create index if not exists sales_internal_lead_sources_email_idx
  on public.sales_internal_lead_sources (email);
create index if not exists sales_internal_lead_sources_created_at_idx
  on public.sales_internal_lead_sources (created_at desc);

alter table public.sales_internal_lead_sources enable row level security;

drop policy if exists sales_internal_lead_sources_select on public.sales_internal_lead_sources;
create policy sales_internal_lead_sources_select
  on public.sales_internal_lead_sources
  for select to authenticated
  using (app.has_min_role('editor'::public.user_role));

revoke all on public.sales_internal_lead_sources from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.sales_internal_lead_sources from authenticated;
grant select on public.sales_internal_lead_sources to authenticated;

drop trigger if exists trg_sales_internal_lead_sources_updated_at on public.sales_internal_lead_sources;
create trigger trg_sales_internal_lead_sources_updated_at
  before update on public.sales_internal_lead_sources
  for each row execute function app.set_updated_at();

drop trigger if exists trg_sales_internal_lead_sources_stamp on public.sales_internal_lead_sources;
create trigger trg_sales_internal_lead_sources_stamp
  before insert or update on public.sales_internal_lead_sources
  for each row execute function app.stamp_actor();

drop trigger if exists trg_sales_internal_lead_sources_audit on public.sales_internal_lead_sources;
create trigger trg_sales_internal_lead_sources_audit
  after insert or update or delete on public.sales_internal_lead_sources
  for each row execute function app.audit_trigger();

alter table public.sales_lead_metadata
  drop constraint if exists sales_lead_metadata_lead_source_check;

alter table public.sales_lead_metadata
  add constraint sales_lead_metadata_lead_source_check
  check (lead_source in ('enquiry', 'proposal_request', 'marketing_contact', 'internal'));

drop view if exists public.v_sales_lead_inbox;

create view public.v_sales_lead_inbox
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
  m.is_test,
  m.created_at,
  m.updated_at,
  case m.lead_source
    when 'enquiry' then e.name
    when 'proposal_request' then p.contact_person
    when 'marketing_contact' then coalesce(mc.full_name, mc.email, mc.phone)
    when 'internal' then il.contact_name
  end as contact_name,
  case m.lead_source
    when 'enquiry' then e.company
    when 'proposal_request' then p.company_name
    when 'marketing_contact' then mc.company
    when 'internal' then il.company_name
  end as company,
  case m.lead_source
    when 'enquiry' then e.email
    when 'proposal_request' then p.email
    when 'marketing_contact' then mc.email
    when 'internal' then il.email
  end as email,
  case m.lead_source
    when 'enquiry' then e.phone
    when 'proposal_request' then p.phone
    when 'marketing_contact' then mc.phone
    when 'internal' then il.phone
  end as phone,
  case m.lead_source
    when 'enquiry' then e.subject
    when 'proposal_request' then coalesce(p.programme, p.category)
    when 'internal' then il.course_interest
    else null
  end as subject
from public.sales_lead_metadata m
left join public.enquiries e on m.lead_source = 'enquiry' and e.id = m.source_id
left join public.proposal_requests p on m.lead_source = 'proposal_request' and p.id = m.source_id
left join public.marketing_contacts mc on m.lead_source = 'marketing_contact' and mc.id = m.source_id
left join public.sales_internal_lead_sources il on m.lead_source = 'internal' and il.id = m.source_id;

revoke all on public.v_sales_lead_inbox from anon;
grant select on public.v_sales_lead_inbox to authenticated;
revoke insert, update, delete, truncate, references, trigger
  on public.v_sales_lead_inbox from authenticated;
grant select, insert, update, delete, truncate, references, trigger
  on public.v_sales_lead_inbox to service_role;
grant select, insert, update, delete, truncate, references, trigger
  on public.v_sales_lead_inbox to postgres;

create or replace function public.create_internal_sales_lead(
  p_contact_name text,
  p_email text default null,
  p_phone text default null,
  p_company_name text default null,
  p_course_interest text default null,
  p_notes text default null,
  p_source_channel text default null,
  p_campaign_id uuid default null,
  p_attribution_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_source_id uuid;
  v_lead_id uuid;
  v_email text;
  v_phone text;
  v_company text;
  v_course_interest text;
  v_notes text;
  v_attribution_notes text;
begin
  if not app.has_min_role('editor'::public.user_role) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if nullif(trim(coalesce(p_email, '')), '') is null
     and nullif(trim(coalesce(p_phone, '')), '') is null then
    raise exception 'contact_method_required' using errcode = 'P0001';
  end if;

  if nullif(trim(coalesce(p_source_channel, '')), '') is not null
     and p_source_channel not in ('facebook', 'tiktok', 'whatsapp', 'website', 'referral', 'other') then
    raise exception 'invalid_attribution_source' using errcode = 'P0001';
  end if;

  v_email := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_phone := nullif(trim(coalesce(p_phone, '')), '');
  v_company := nullif(trim(coalesce(p_company_name, '')), '');
  v_course_interest := nullif(trim(coalesce(p_course_interest, '')), '');
  v_notes := nullif(trim(coalesce(p_notes, '')), '');
  v_attribution_notes := nullif(trim(coalesce(p_attribution_notes, '')), '');

  if v_email is not null and v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception 'invalid_email' using errcode = 'P0001';
  end if;

  insert into public.sales_internal_lead_sources (
    contact_name, email, phone, company_name, course_interest, notes, created_by
  )
  values (
    trim(p_contact_name), v_email, v_phone, v_company, v_course_interest, v_notes, auth.uid()
  )
  returning id into v_source_id;

  insert into public.sales_lead_metadata (lead_source, source_id, status, priority)
  values ('internal', v_source_id, 'new', 'medium')
  returning id into v_lead_id;

  insert into public.sales_activity (lead_metadata_id, type, note, actor_id)
  values (v_lead_id, 'lead_created', 'Lead created manually in Sales CRM', auth.uid());

  if p_source_channel is not null
     or p_campaign_id is not null
     or v_attribution_notes is not null then
    if nullif(trim(coalesce(p_source_channel, '')), '') is null then
      raise exception 'attribution_source_required' using errcode = 'P0001';
    end if;

    insert into public.sales_lead_attributions (
      lead_metadata_id, source, campaign_id, notes
    )
    values (v_lead_id, p_source_channel, p_campaign_id, v_attribution_notes);
  end if;

  return v_lead_id;
end;
$function$;

revoke all on function public.create_internal_sales_lead(text, text, text, text, text, text, text, uuid, text) from public;
grant execute on function public.create_internal_sales_lead(text, text, text, text, text, text, text, uuid, text) to authenticated;
revoke execute on function public.create_internal_sales_lead(text, text, text, text, text, text, text, uuid, text) from anon;
