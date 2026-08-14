-- Sales CRM Phase 3 — Won Opportunity -> Training Schedule handoff.
--
-- Traceability only: this does NOT duplicate the Sales record into
-- course_schedules (company/contact/quotation totals stay in Sales tables
-- and are shown to staff as free-text context at creation time, not
-- persisted as new columns here). Only the two source IDs are stored, so a
-- schedule can always be traced back to the opportunity/quotation that
-- produced it.
--
-- Both are nullable: a schedule created through the normal (non-handoff)
-- flow has neither set. on delete set null (not cascade) so deleting a Sales
-- record never deletes real training-operations data.
--
-- Idempotent: safe to re-run.

alter table public.course_schedules
  add column if not exists source_opportunity_id uuid references public.sales_opportunities(id) on delete set null;

alter table public.course_schedules
  add column if not exists source_quotation_id uuid references public.sales_quotations(id) on delete set null;

-- Duplicate-handoff protection (Task 7): a DB constraint, not just a
-- disabled button. Partial + scoped to deleted_at is null so a soft-deleted
-- schedule releases the opportunity for a fresh handoff attempt.
create unique index if not exists course_schedules_source_opportunity_unique
  on public.course_schedules (source_opportunity_id)
  where source_opportunity_id is not null and deleted_at is null;

-- Covering index for the new FK column used in filters/joins (CLAUDE.md §13
-- — Postgres does not auto-index FK columns).
create index if not exists course_schedules_source_quotation_id_idx
  on public.course_schedules (source_quotation_id)
  where source_quotation_id is not null;

comment on column public.course_schedules.source_opportunity_id is
  'Traceability only, set exclusively by the Sales -> Training Operations handoff. Null for schedules created the normal way.';
comment on column public.course_schedules.source_quotation_id is
  'The accepted quotation the handoff was created from, if any. Traceability only.';
