-- Sales lead contact corrections: apply the overlay in v_sales_lead_inbox (4 of 4). NOT APPLIED anywhere yet.
--
-- Why: every Sales screen, the CSV export, the registration-from-lead prefill and
-- convert_lead_to_opportunity() read contact details through this view, so applying the
-- overlay here makes a correction visible everywhere without touching the source rows.
--
-- Contract preserved: the same 17 columns with the same names, types and order, owner and
-- grants unchanged (CREATE OR REPLACE keeps ACL and ownership). reloptions are REPLACED by
-- CREATE OR REPLACE, so security_invoker is stated again. Overlay rows are complete contact
-- records: when a row exists its four values win (so a field can be cleared); marketing
-- contact leads never use it because they are managed in the Marketing module.
--
-- The post-conditions abort the migration if the column list, security_invoker or the view
-- privileges are not exactly as before.
--
-- Rollback (forward repair, separate migration): re-create the previous definition, which is
-- the one in 20260911090000_internal_sales_lead_creation.sql, with security_invoker = true.
-- Existing consumers need no change.

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
  m.is_test,
  m.created_at,
  m.updated_at,
  case when o.id is not null and m.lead_source in ('enquiry', 'proposal_request', 'internal') then o.contact_name
    else case m.lead_source
      when 'enquiry' then e.name
      when 'proposal_request' then p.contact_person
      when 'marketing_contact' then coalesce(mc.full_name, mc.email, mc.phone)
      when 'internal' then il.contact_name
    end
  end as contact_name,
  case when o.id is not null and m.lead_source in ('enquiry', 'proposal_request', 'internal') then o.company
    else case m.lead_source
      when 'enquiry' then e.company
      when 'proposal_request' then p.company_name
      when 'marketing_contact' then mc.company
      when 'internal' then il.company_name
    end
  end as company,
  case when o.id is not null and m.lead_source in ('enquiry', 'proposal_request', 'internal') then o.email
    else case m.lead_source
      when 'enquiry' then e.email
      when 'proposal_request' then p.email
      when 'marketing_contact' then mc.email
      when 'internal' then il.email
    end
  end as email,
  case when o.id is not null and m.lead_source in ('enquiry', 'proposal_request', 'internal') then o.phone
    else case m.lead_source
      when 'enquiry' then e.phone
      when 'proposal_request' then p.phone
      when 'marketing_contact' then mc.phone
      when 'internal' then il.phone
    end
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
left join public.sales_internal_lead_sources il on m.lead_source = 'internal' and il.id = m.source_id
left join public.sales_lead_contact_overrides o on o.lead_metadata_id = m.id;

do $$
declare
  v_cols text;
  v_expected constant text :=
    'lead_metadata_id:uuid, lead_source:text, source_id:uuid, status:text, assigned_to:uuid, follow_up_at:timestamp with time zone, priority:text, lost_reason:text, won_at:timestamp with time zone, is_test:boolean, created_at:timestamp with time zone, updated_at:timestamp with time zone, contact_name:text, company:text, email:text, phone:text, subject:text';
begin
  select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ', ' order by a.attnum)
    into v_cols
  from pg_attribute a
  where a.attrelid = 'public.v_sales_lead_inbox'::regclass and a.attnum > 0 and not a.attisdropped;
  if v_cols is distinct from v_expected then
    raise exception 'lead_contact_postcondition_failed: view columns changed' using errcode = 'P0001';
  end if;
  if not coalesce((select 'security_invoker=true' = any (reloptions)
                   from pg_class where oid = 'public.v_sales_lead_inbox'::regclass), false) then
    raise exception 'lead_contact_postcondition_failed: security_invoker lost' using errcode = 'P0001';
  end if;
  if has_table_privilege('anon', 'public.v_sales_lead_inbox', 'select')
     or not has_table_privilege('authenticated', 'public.v_sales_lead_inbox', 'select') then
    raise exception 'lead_contact_postcondition_failed: view privileges changed' using errcode = 'P0001';
  end if;
end $$;
