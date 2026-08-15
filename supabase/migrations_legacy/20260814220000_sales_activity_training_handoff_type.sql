-- Sales CRM Phase 3 handoff — sales_activity.type CHECK extended additively
-- (same pattern Phase 2 used: the constraint is dropped and recreated with
-- the existing 16 values plus the one new value, never narrowed).
--
-- 'training_handoff_created' is logged once, by schedules/actions.ts's
-- createSchedule(), when a course_schedules row is created with a
-- source_opportunity_id set (see 20260814210000's traceability columns).
--
-- Idempotent: safe to re-run.

alter table public.sales_activity drop constraint if exists sales_activity_type_check;
alter table public.sales_activity add constraint sales_activity_type_check
  check (type = any (array[
    'lead_created', 'status_changed', 'assigned', 'followup_scheduled', 'note_added',
    'proposal_sent', 'won', 'lost', 'opportunity_created', 'quotation_created',
    'quotation_sent', 'quotation_revised', 'quotation_accepted', 'quotation_rejected',
    'opportunity_won', 'opportunity_lost', 'training_handoff_created'
  ]));
