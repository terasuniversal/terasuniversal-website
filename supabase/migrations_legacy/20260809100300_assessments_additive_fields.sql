-- Additive: split the live assessments table's merged result/competency
-- concept into two columns, and add nullable score fields so awareness
-- programmes (no scores at all) and competency programmes (scores +
-- competency_status) can both be represented without fabricating data.

alter table public.assessments
  add column if not exists theory_score numeric(5,2),
  add column if not exists practical_score numeric(5,2),
  add column if not exists competency_status text,
  add column if not exists locked boolean not null default false,
  add column if not exists locked_at timestamptz,
  add column if not exists locked_by uuid references public.profiles (id),
  add column if not exists assessor_id uuid references public.profiles (id),
  add column if not exists deleted_at timestamptz;

-- overall_score is deliberately NOT added as a column in this migration --
-- no single averaging formula is confirmed across TERAS's programmes yet.
-- Computed at the application/report layer instead (see application changes).

alter table public.assessments drop constraint if exists assessments_result_check;
alter table public.assessments add constraint assessments_result_check
  check (result in ('pending', 'pass', 'fail'));

alter table public.assessments drop constraint if exists assessments_competency_status_check;
alter table public.assessments add constraint assessments_competency_status_check
  check (competency_status is null or competency_status in ('pending_review', 'competent', 'not_yet_competent'));

create index if not exists assessments_schedule_idx
  on public.assessments (schedule_id) where deleted_at is null;
create index if not exists assessments_participant_idx
  on public.assessments (participant_id) where deleted_at is null;

drop trigger if exists trg_assessments_updated_at on public.assessments;
create trigger trg_assessments_updated_at
  before update on public.assessments
  for each row execute function app.set_updated_at();

drop trigger if exists trg_assessments_audit on public.assessments;
create trigger trg_assessments_audit
  after insert or update or delete on public.assessments
  for each row execute function app.audit_trigger();
