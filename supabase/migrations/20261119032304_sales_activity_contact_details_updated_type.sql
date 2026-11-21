-- Sales lead contact corrections: allow the timeline event type (2 of 4). NOT APPLIED anywhere yet.
--
-- Why: sales_activity.type is restricted by sales_activity_type_check and has no value
-- for "contact details corrected". The RPC in migration 3 writes one timeline row per
-- correction with metadata {"fields": [...], "version": n} (field NAMES only, never
-- values).
--
-- Scope: widens one CHECK constraint (adds 'contact_details_updated'). The existing
-- definition is identical on Production and Custom Staging (md5 below); the migration
-- refuses to run against a drifted definition rather than overwrite it.
--
-- Rollback: forward repair only (re-create the constraint without the new value once no
-- row uses it).

do $$
begin
  if not exists (
    select 1 from pg_constraint c
    where c.conrelid = 'public.sales_activity'::regclass
      and c.conname = 'sales_activity_type_check'
      and (md5(pg_get_constraintdef(c.oid)) = '4f5a287306dfc57f6b3ae5be23c73579'
           or pg_get_constraintdef(c.oid) like '%contact_details_updated%')
  ) then
    raise exception 'lead_contact_precondition_failed: sales_activity_type_check differs from the verified definition' using errcode = 'P0001';
  end if;
end $$;

alter table public.sales_activity drop constraint if exists sales_activity_type_check;
alter table public.sales_activity add constraint sales_activity_type_check check (type = any (array[
  'assigned', 'company_created', 'company_linked', 'followup_scheduled', 'invoice_cancelled', 'invoice_created',
  'invoice_issued', 'invoice_paid', 'invoice_partially_paid', 'lead_created', 'lost', 'note_added',
  'opportunity_created', 'opportunity_lost', 'opportunity_reversed', 'opportunity_won', 'payment_recorded',
  'priority_changed', 'proposal_sent', 'qualification_changed', 'quotation_accepted', 'quotation_cancelled',
  'quotation_created', 'quotation_rejected', 'quotation_revised', 'quotation_sent', 'receipt_issued',
  'registration_completed', 'status_changed', 'task_cancelled', 'task_completed', 'task_created', 'task_reopened',
  'temperature_changed', 'training_handoff_created', 'won', 'contact_details_updated'
]::text[]));
