-- Sales Lead Qualification Foundation
-- Additive staging rehearsal migration. No lifecycle, conversion, or RLS changes.

alter table public.sales_lead_metadata
  add column if not exists qualification_status text not null default 'pending',
  add column if not exists temperature text,
  add column if not exists qualification_reason text,
  add column if not exists disqualification_reason text,
  add column if not exists qualification_changed_at timestamptz,
  add column if not exists qualification_changed_by uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'sales_lead_metadata_qualification_status_check'
      and conrelid = 'public.sales_lead_metadata'::regclass
  ) then
    alter table public.sales_lead_metadata
      add constraint sales_lead_metadata_qualification_status_check
      check (qualification_status in ('pending', 'qualified', 'unqualified'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'sales_lead_metadata_temperature_check'
      and conrelid = 'public.sales_lead_metadata'::regclass
  ) then
    alter table public.sales_lead_metadata
      add constraint sales_lead_metadata_temperature_check
      check (temperature is null or temperature in ('hot', 'warm', 'cold'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'sales_lead_metadata_qualification_reason_check'
      and conrelid = 'public.sales_lead_metadata'::regclass
  ) then
    alter table public.sales_lead_metadata
      add constraint sales_lead_metadata_qualification_reason_check
      check (
        qualification_reason is null
        or qualification_reason in (
          'course_match', 'budget_confirmed', 'decision_maker_engaged',
          'training_date_fit', 'company_requirement_confirmed',
          'repeat_client', 'other'
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'sales_lead_metadata_disqualification_reason_check'
      and conrelid = 'public.sales_lead_metadata'::regclass
  ) then
    alter table public.sales_lead_metadata
      add constraint sales_lead_metadata_disqualification_reason_check
      check (
        disqualification_reason is null
        or disqualification_reason in (
          'no_budget', 'no_requirement', 'wrong_course', 'outside_target',
          'no_response', 'timing_not_suitable', 'duplicate',
          'invalid_contact', 'other'
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'sales_lead_metadata_qualification_reason_state_check'
      and conrelid = 'public.sales_lead_metadata'::regclass
  ) then
    alter table public.sales_lead_metadata
      add constraint sales_lead_metadata_qualification_reason_state_check
      check (
        (qualification_status = 'pending'
          and qualification_reason is null
          and disqualification_reason is null)
        or (qualification_status = 'qualified'
          and disqualification_reason is null)
        or (qualification_status = 'unqualified'
          and qualification_reason is null)
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'sales_lead_metadata_qualification_changed_by_fkey'
      and conrelid = 'public.sales_lead_metadata'::regclass
  ) then
    alter table public.sales_lead_metadata
      add constraint sales_lead_metadata_qualification_changed_by_fkey
      foreign key (qualification_changed_by)
      references public.profiles(id)
      on delete set null;
  end if;
end
$$;

alter table public.sales_activity
  add column if not exists metadata jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'sales_activity_metadata_object_check'
      and conrelid = 'public.sales_activity'::regclass
  ) then
    alter table public.sales_activity
      add constraint sales_activity_metadata_object_check
      check (jsonb_typeof(metadata) = 'object');
  end if;
end
$$;

alter table public.sales_activity
  drop constraint if exists sales_activity_type_check;

alter table public.sales_activity
  add constraint sales_activity_type_check
  check (type = any (array[
    'lead_created', 'status_changed', 'assigned', 'followup_scheduled',
    'note_added', 'proposal_sent', 'won', 'lost', 'opportunity_created',
    'quotation_created', 'quotation_sent', 'quotation_revised',
    'quotation_accepted', 'quotation_rejected', 'opportunity_won',
    'opportunity_lost', 'training_handoff_created', 'company_linked',
    'company_created', 'task_created', 'task_completed', 'task_reopened',
    'task_cancelled', 'registration_completed', 'invoice_created',
    'invoice_issued', 'invoice_partially_paid', 'invoice_paid',
    'invoice_cancelled', 'payment_recorded', 'quotation_cancelled',
    'opportunity_reversed', 'qualification_changed',
    'temperature_changed', 'priority_changed'
  ]));

create index if not exists sales_lead_metadata_qualification_status_updated_at_idx
  on public.sales_lead_metadata (qualification_status, updated_at desc);

create index if not exists sales_lead_metadata_temperature_follow_up_at_idx
  on public.sales_lead_metadata (temperature, follow_up_at);

update public.sales_lead_metadata
set qualification_status = case
  when status in ('qualified', 'proposal_sent', 'negotiation', 'won') then 'qualified'
  when status in ('new', 'contacted', 'lost', 'archived') then 'pending'
  else 'pending'
end
where qualification_status = 'pending';
