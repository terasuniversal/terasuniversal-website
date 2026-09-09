-- READ-ONLY preflight for Sales Revenue Integrity Hardening.
-- This file intentionally contains SELECTs only.

\echo 'Duplicate accepted quotations'
select opportunity_id, count(*) as accepted_count, array_agg(id order by accepted_at, revision_no, id) as quotation_ids
from public.sales_quotations where status = 'accepted'
group by opportunity_id having count(*) > 1;

\echo 'Accepted quotations marked superseded'
select id, opportunity_id, revision_no, accepted_at, superseded_at
from public.sales_quotations where status = 'accepted' and superseded_at is not null;

\echo 'Won opportunities without accepted quotation'
select o.id, o.lead_metadata_id from public.sales_opportunities o
where o.stage = 'won' and not exists (
  select 1 from public.sales_quotations q where q.opportunity_id = o.id and q.status = 'accepted'
);

\echo 'Accepted quotations on non-Won opportunities'
select q.id, q.opportunity_id, o.stage
from public.sales_quotations q join public.sales_opportunities o on o.id = q.opportunity_id
where q.status = 'accepted' and o.stage <> 'won';

\echo 'Active payment dependencies'
select i.opportunity_id, i.id as invoice_id, ip.id as payment_id, ip.status
from public.invoice_payments ip join public.invoices i on i.id = ip.invoice_id
where ip.status in ('pending', 'successful');

\echo 'Training schedules linked by quotation but not opportunity'
select cs.id, cs.schedule_code, cs.source_quotation_id, cs.source_opportunity_id, cs.status, cs.deleted_at
from public.course_schedules cs
where cs.source_quotation_id is not null and cs.source_opportunity_id is null;

\echo 'UNRESOLVED / UNATTRIBUTED LEGACY CANDIDATES — schedules with neither Sales source linkage'
select cs.id as schedule_id, cs.schedule_code, c.title as course_title, cs.status as schedule_status,
       (select count(*) from public.schedule_participants sp
        where sp.schedule_id = cs.id and sp.deleted_at is null) as participant_count,
       cs.created_at, cs.source_opportunity_id, cs.source_quotation_id
from public.course_schedules cs
join public.courses c on c.id = cs.course_id
where cs.source_quotation_id is null and cs.source_opportunity_id is null and cs.deleted_at is null;

\echo 'Active registrations on Sales-linked schedules'
select cs.id as schedule_id, cs.schedule_code, cs.source_opportunity_id, cs.source_quotation_id,
       sp.id as schedule_participant_id, sp.registration_status
from public.course_schedules cs join public.schedule_participants sp on sp.schedule_id = cs.id
where cs.deleted_at is null and sp.deleted_at is null
  and sp.registration_status in ('registered', 'confirmed', 'completed');

\echo 'Function owners (must be postgres before staging apply)'
select n.nspname as schema_name, p.proname, pg_get_function_identity_arguments(p.oid) as arguments,
       pg_get_userbyid(p.proowner) as owner
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where (n.nspname, p.proname) in (('public', 'accept_quotation'), ('public', 'reverse_won_opportunity'),
                                  ('app', 'guard_sales_revenue_mutation'))
order by n.nspname, p.proname;

\echo 'Trigger function owners'
select tg.tgname, pg_get_userbyid(p.proowner) as owner
from pg_trigger tg
join pg_proc p on p.oid = tg.tgfoid
where tg.tgname in ('trg_guard_sales_quotation_revenue_mutation',
                    'trg_guard_sales_opportunity_revenue_mutation');
