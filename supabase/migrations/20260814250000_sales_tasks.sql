-- Sales CRM Phase 4B — real Sales Tasks table, replacing the SalesPlaceholder
-- demo stub at /admin/sales/tasks.
--
-- Small and deliberately minimal (Task 6's own instruction: "do not build a
-- project-management suite"). Follow-ups are NOT duplicated here — Phase 4B
-- reuses sales_lead_metadata.follow_up_at/priority as-is (see Task 5's
-- decision, documented in the accompanying report: opportunities are 1:1
-- with a lead_metadata row via convert_lead_to_opportunity()'s own
-- already-exists guard, so a second opportunity-level follow-up timestamp
-- would just be a second, driftable copy of the same fact).
--
-- Relationships are optional and independent (a task may link none, one, or
-- several of lead/opportunity/quotation) -- no full Sales record is copied
-- in, only IDs.
--
-- Idempotent: safe to re-run.

create table if not exists public.sales_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  status text not null default 'open',
  priority text not null default 'medium',
  due_at timestamptz,
  assigned_to uuid references public.profiles(id) on delete set null,
  lead_metadata_id uuid references public.sales_lead_metadata(id) on delete set null,
  opportunity_id uuid references public.sales_opportunities(id) on delete set null,
  quotation_id uuid references public.sales_quotations(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Soft-delete, matching every other Sales/CMS table's convention.
  -- Task 17: prefer status='cancelled' for "I don't want to do this
  -- anymore" (a real, visible lifecycle state); deleted_at is reserved for
  -- actually removing a mistaken row from view, same split as
  -- course_schedules' status vs deleted_at.
  deleted_at timestamptz
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'sales_tasks_status_check') then
    alter table public.sales_tasks add constraint sales_tasks_status_check
      check (status = any (array['open', 'in_progress', 'completed', 'cancelled']));
  end if;
  -- Same 3-value family as sales_lead_metadata_priority_check (low/medium/high)
  -- -- confirmed live before writing this, not the low/normal/high/urgent set
  -- assumed in the task brief, per the explicit "do not create conflicting
  -- labels" instruction.
  if not exists (select 1 from pg_constraint where conname = 'sales_tasks_priority_check') then
    alter table public.sales_tasks add constraint sales_tasks_priority_check
      check (priority = any (array['low', 'medium', 'high']));
  end if;
end $$;

-- Indexes: due-date queue queries, per-relation lookups, owner filter.
create index if not exists sales_tasks_due_at_idx on public.sales_tasks (due_at) where deleted_at is null;
create index if not exists sales_tasks_assigned_to_idx on public.sales_tasks (assigned_to) where deleted_at is null;
create index if not exists sales_tasks_status_idx on public.sales_tasks (status) where deleted_at is null;
create index if not exists sales_tasks_lead_metadata_id_idx on public.sales_tasks (lead_metadata_id) where lead_metadata_id is not null;
create index if not exists sales_tasks_opportunity_id_idx on public.sales_tasks (opportunity_id) where opportunity_id is not null;
create index if not exists sales_tasks_quotation_id_idx on public.sales_tasks (quotation_id) where quotation_id is not null;

alter table public.sales_tasks enable row level security;

-- RLS (Task 16): editor+ read; editor+ create (always stamped as their own
-- creation); editor+ update their OWN task (assigned_to or created_by =
-- self); admin+ can update/soft-delete ANY task, including reassigning to
-- other staff -- "assign to other staff" is enforced at the app layer
-- (createTask/updateTask reject a non-self assignee unless the actor is
-- admin+), matching CLAUDE.md's "RLS is the real boundary, app guards
-- mirror it" pattern used everywhere else in this codebase.
drop policy if exists sales_tasks_select on public.sales_tasks;
create policy sales_tasks_select on public.sales_tasks for select to authenticated
  using (app.has_min_role('editor'::user_role));

drop policy if exists sales_tasks_insert on public.sales_tasks;
create policy sales_tasks_insert on public.sales_tasks for insert to authenticated
  with check (app.has_min_role('editor'::user_role));

drop policy if exists sales_tasks_update on public.sales_tasks;
create policy sales_tasks_update on public.sales_tasks for update to authenticated
  using (app.is_admin() or assigned_to = auth.uid() or created_by = auth.uid())
  with check (app.is_admin() or assigned_to = auth.uid() or created_by = auth.uid());

drop policy if exists sales_tasks_delete on public.sales_tasks;
create policy sales_tasks_delete on public.sales_tasks for delete to authenticated
  using (app.is_admin());

-- Belt-and-suspenders (this project's default-privileges quirk, documented
-- repeatedly elsewhere in this migration lineage): explicit table grants
-- plus an anon revoke, since default privileges otherwise grant new tables
-- broad authenticated/anon access regardless of RLS.
grant select, insert, update, delete on public.sales_tasks to authenticated;
revoke all on public.sales_tasks from anon;

-- Standard audit/stamp/updated_at trigger set, same three functions and
-- naming convention as companies/course_schedules/schedule_participants.
drop trigger if exists trg_sales_tasks_audit on public.sales_tasks;
create trigger trg_sales_tasks_audit after insert or update or delete on public.sales_tasks
  for each row execute function app.audit_trigger();

drop trigger if exists trg_sales_tasks_stamp on public.sales_tasks;
create trigger trg_sales_tasks_stamp before insert or update on public.sales_tasks
  for each row execute function app.stamp_actor();

drop trigger if exists trg_sales_tasks_updated_at on public.sales_tasks;
create trigger trg_sales_tasks_updated_at before update on public.sales_tasks
  for each row execute function app.set_updated_at();

comment on table public.sales_tasks is
  'Sales CRM Phase 4B — general sales to-dos, optionally linked to a lead/opportunity/quotation. Not a project-management suite; deliberately minimal.';

-- sales_activity.type CHECK extended additively (same pattern as every
-- prior phase): 4 meaningful task lifecycle events only, per Task 12 --
-- no event for in_progress or trivial edits.
alter table public.sales_activity drop constraint if exists sales_activity_type_check;
alter table public.sales_activity add constraint sales_activity_type_check
  check (type = any (array[
    'lead_created', 'status_changed', 'assigned', 'followup_scheduled', 'note_added',
    'proposal_sent', 'won', 'lost', 'opportunity_created', 'quotation_created',
    'quotation_sent', 'quotation_revised', 'quotation_accepted', 'quotation_rejected',
    'opportunity_won', 'opportunity_lost', 'training_handoff_created',
    'company_linked', 'company_created',
    'task_created', 'task_completed', 'task_reopened', 'task_cancelled'
  ]));
