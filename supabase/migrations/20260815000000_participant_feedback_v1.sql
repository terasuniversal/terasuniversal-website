-- =====================================================================
-- TERAS UNIVERSAL — Participant Feedback Module (Phase 1)
-- =====================================================================
-- Public feedback form + admin dashboard/issues/improvement actions.
--
-- Design notes:
--   * Reuses the LIVE canonical relationships: course_schedules (schedules)
--     and schedule_participants -> participants (enrollment join). No
--     parallel training/participant architecture is introduced.
--   * One participant + one schedule = one feedback row (UNIQUE constraint
--     on (schedule_id, participant_id)). Admin may reopen a submission only
--     through the authorised server action (which audits it); reopening
--     returns the SAME row to 'pending' for resubmission.
--   * Public access is token-based (/feedback/[token]) and goes ONLY through
--     SECURITY DEFINER RPCs granted to anon. anon has NO table access.
--   * Feedback must NOT block certificate issuance — this migration does not
--     touch certificate eligibility rules or the v_certificate_eligibility
--     views/functions in any way.
--   * Privacy: participant identity lives in participant_feedback.participant_id.
--     Trainer (and below) get NO policy on the base tables, so they cannot
--     retrieve identity through direct API/RLS access. Trainer-facing reads
--     must use the anonymised feedback_anonymous_stats() aggregate only.
--   * Issue/improvement-action transitions are enforced both in the app
--     layer (Zod + actions) and by a database trigger (defence in depth).
--     RESOLVED -> CLOSED is deliberately not a permitted transition; the
--     workflow requires RESOLVED -> VERIFIED -> CLOSED.
--
-- All DDL is idempotent (create ... if not exists / create or replace) and
-- follows the compatibility-track style of this repository.
-- =====================================================================

-- --- Tables -----------------------------------------------------------

create table if not exists public.participant_feedback (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.course_schedules(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  token text not null,
  status text not null default 'pending' check (status in ('pending', 'submitted')),
  q1_score smallint check (q1_score between 1 and 5),
  q2_score smallint check (q2_score between 1 and 5),
  q3_score smallint check (q3_score between 1 and 5),
  q4_score smallint check (q4_score between 1 and 5),
  q5_score smallint check (q5_score between 1 and 5),
  q6_score smallint check (q6_score between 1 and 5),
  q7_score smallint check (q7_score between 1 and 5),
  q8_score smallint check (q8_score between 1 and 5),
  q9_score smallint check (q9_score between 1 and 5),
  q10_score smallint check (q10_score between 1 and 5),
  nps smallint check (nps between 0 and 10),
  liked_most text check (char_length(liked_most) <= 2000),
  improve text check (char_length(improve) <= 2000),
  had_problem boolean not null default false,
  problem_category text check (
    problem_category in (
      'registration','trainer','training_material','practical_equipment','venue',
      'food_refreshment','schedule','assessment_examination','certificate',
      'staff_service','others'
    ) or problem_category is null
  ),
  problem_description text check (char_length(problem_description) <= 2000),
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint participant_feedback_one_per_enrollment unique (schedule_id, participant_id)
);

create unique index if not exists participant_feedback_token_unique
  on public.participant_feedback (token);
create index if not exists participant_feedback_schedule_idx
  on public.participant_feedback (schedule_id);
create index if not exists participant_feedback_participant_idx
  on public.participant_feedback (participant_id);
create index if not exists participant_feedback_status_idx
  on public.participant_feedback (status);
create index if not exists participant_feedback_submitted_idx
  on public.participant_feedback (submitted_at) where submitted_at is not null;

comment on table public.participant_feedback is
  'Participant feedback per schedule/enrollment. participant_id is stored for '
  'duplicate prevention / response-rate calculations only; trainers have no '
  'RLS access to this table.';

create table if not exists public.feedback_issues (
  id uuid primary key default gen_random_uuid(),
  source_feedback_id uuid references public.participant_feedback(id) on delete set null,
  schedule_id uuid references public.course_schedules(id) on delete set null,
  category text check (char_length(category) <= 120),
  department text check (char_length(department) <= 160),
  title text not null check (char_length(title) between 3 and 240),
  description text check (char_length(description) <= 4000),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'critical')),
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'closed')),
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists feedback_issues_schedule_idx on public.feedback_issues(schedule_id) where deleted_at is null;
create index if not exists feedback_issues_status_idx on public.feedback_issues(status) where deleted_at is null;
create index if not exists feedback_issues_source_idx on public.feedback_issues(source_feedback_id) where deleted_at is null;

create table if not exists public.feedback_improvement_actions (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.feedback_issues(id) on delete cascade,
  schedule_id uuid references public.course_schedules(id) on delete set null,
  category text check (char_length(category) <= 120),
  department text check (char_length(department) <= 160),
  title text not null check (char_length(title) between 3 and 240),
  description text check (char_length(description) <= 4000),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'critical')),
  status text not null default 'open' check (
    status in ('open', 'assigned', 'in_progress', 'resolved', 'verified', 'closed')
  ),
  assigned_to uuid references public.profiles(id),
  due_date date,
  corrective_action text check (char_length(corrective_action) <= 4000),
  verification_note text check (char_length(verification_note) <= 4000),
  resolved_at timestamptz,
  verified_at timestamptz,
  closed_at timestamptz,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists feedback_actions_issue_idx on public.feedback_improvement_actions(issue_id);
create index if not exists feedback_actions_schedule_idx on public.feedback_improvement_actions(schedule_id);
create index if not exists feedback_actions_status_idx on public.feedback_improvement_actions(status);
create index if not exists feedback_actions_assigned_idx on public.feedback_improvement_actions(assigned_to) where assigned_to is not null;

-- --- RLS (editor+ for everything; trainer and below have NO base-table
--      access; anon has none either — public flows go through RPCs only) ---

alter table public.participant_feedback enable row level security;
alter table public.feedback_issues enable row level security;
alter table public.feedback_improvement_actions enable row level security;

drop policy if exists participant_feedback_staff_all on public.participant_feedback;
drop policy if exists participant_feedback_staff_select on public.participant_feedback;
create policy participant_feedback_staff_select on public.participant_feedback
  for select to authenticated
  using ((select app.has_min_role('editor'::public.user_role)));

do $$ declare t text; begin
  foreach t in array array['feedback_issues','feedback_improvement_actions'] loop
    execute format('drop policy if exists %I on public.%I', t || '_staff_all', t);
    execute format('drop policy if exists %I on public.%I', t || '_staff_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_staff_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_staff_update', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select app.has_min_role(%L::public.user_role)))', t || '_staff_select', t, 'editor');
    execute format('create policy %I on public.%I for insert to authenticated with check ((select app.has_min_role(%L::public.user_role)))', t || '_staff_insert', t, 'editor');
    execute format('create policy %I on public.%I for update to authenticated using ((select app.has_min_role(%L::public.user_role))) with check ((select app.has_min_role(%L::public.user_role)))', t || '_staff_update', t, 'editor', 'editor');
  end loop;
end $$;

revoke all on public.participant_feedback, public.feedback_issues, public.feedback_improvement_actions from authenticated;
grant select on public.participant_feedback to authenticated;
grant select, insert, update on public.feedback_issues, public.feedback_improvement_actions to authenticated;
revoke all on public.participant_feedback, public.feedback_issues, public.feedback_improvement_actions from anon;

-- --- Triggers: updated_at, actor stamping, audit trail -----------------

drop trigger if exists trg_participant_feedback_updated_at on public.participant_feedback;
create trigger trg_participant_feedback_updated_at
  before update on public.participant_feedback
  for each row execute function app.set_updated_at();
drop trigger if exists trg_participant_feedback_audit on public.participant_feedback;
create trigger trg_participant_feedback_audit
  after insert or update or delete on public.participant_feedback
  for each row execute function app.audit_trigger();

drop trigger if exists trg_feedback_issues_updated_at on public.feedback_issues;
create trigger trg_feedback_issues_updated_at
  before update on public.feedback_issues
  for each row execute function app.set_updated_at();
drop trigger if exists trg_feedback_issues_stamp on public.feedback_issues;
create trigger trg_feedback_issues_stamp
  before insert or update on public.feedback_issues
  for each row execute function app.stamp_actor();
drop trigger if exists trg_feedback_issues_audit on public.feedback_issues;
create trigger trg_feedback_issues_audit
  after insert or update or delete on public.feedback_issues
  for each row execute function app.audit_trigger();

drop trigger if exists trg_feedback_actions_updated_at on public.feedback_improvement_actions;
create trigger trg_feedback_actions_updated_at
  before update on public.feedback_improvement_actions
  for each row execute function app.set_updated_at();
drop trigger if exists trg_feedback_actions_stamp on public.feedback_improvement_actions;
create trigger trg_feedback_actions_stamp
  before insert or update on public.feedback_improvement_actions
  for each row execute function app.stamp_actor();
drop trigger if exists trg_feedback_actions_audit on public.feedback_improvement_actions;
create trigger trg_feedback_actions_audit
  after insert or update or delete on public.feedback_improvement_actions
  for each row execute function app.audit_trigger();

-- --- Improvement Action transition guard ------------------------------
-- RESOLVED -> CLOSED is NOT a permitted transition; the workflow requires
-- RESOLVED -> VERIFIED -> CLOSED. Enforced in the DB so no client or app
-- path can bypass the rule. The app layer validates the same transitions.
create or replace function app.feedback_action_transition_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and old.status is distinct from new.status then
    if not (
      (old.status = 'open' and new.status = 'assigned')
      or (old.status = 'assigned' and new.status = 'in_progress')
      or (old.status = 'in_progress' and new.status = 'resolved')
      or (old.status = 'resolved' and new.status = 'verified')
      or (old.status = 'verified' and new.status = 'closed')
    ) then
      raise exception 'Invalid improvement action transition: % -> % (RESOLVED must be VERIFIED before CLOSED)', old.status, new.status;
    end if;
    new.resolved_at := case when new.status = 'resolved' then coalesce(new.resolved_at, now()) else new.resolved_at end;
    new.verified_at := case when new.status = 'verified' then coalesce(new.verified_at, now()) else new.verified_at end;
    new.closed_at   := case when new.status = 'closed'   then coalesce(new.closed_at,   now()) else new.closed_at   end;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_feedback_actions_transition_guard on public.feedback_improvement_actions;
create trigger trg_feedback_actions_transition_guard
  before update on public.feedback_improvement_actions
  for each row execute function app.feedback_action_transition_guard();

-- Issues move forward one step at a time. Phase 1 does not model a
-- cancellation reason or reopening, so jumps and reverse moves are rejected.
create or replace function app.feedback_issue_transition_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and old.status is distinct from new.status then
    if not (
      (old.status = 'open' and new.status = 'in_progress')
      or (old.status = 'in_progress' and new.status = 'resolved')
      or (old.status = 'resolved' and new.status = 'closed')
    ) then
      raise exception 'Invalid feedback issue transition: % -> %', old.status, new.status;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_feedback_issues_transition_guard on public.feedback_issues;
create trigger trg_feedback_issues_transition_guard
  before update on public.feedback_issues
  for each row execute function app.feedback_issue_transition_guard();

-- --- Public RPC: resolve a feedback token ------------------------------
-- Returns ONLY public-safe info (no participant identity). No rows = invalid.
create or replace function public.feedback_get_by_token(p_token text)
returns table (
  valid boolean,
  already_submitted boolean,
  course_title text,
  schedule_code text,
  schedule_start date,
  schedule_end date,
  venue text,
  trainer_name text
)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v record;
begin
  select
    true as valid,
    pf.status = 'submitted' as already_submitted,
    coalesce(c.title, c.course_name) as course_title,
    cs.schedule_code,
    cs.start_date as schedule_start,
    cs.end_date as schedule_end,
    cs.venue,
    cs.trainer_name
  into v
  from public.participant_feedback pf
  join public.course_schedules cs on cs.id = pf.schedule_id
  join public.courses c on c.id = cs.course_id
  where pf.token = trim(p_token)
    and cs.deleted_at is null
  limit 1;

  if not found then return; end if;
  return query select v.valid, v.already_submitted, v.course_title, v.schedule_code,
                      v.schedule_start, v.schedule_end, v.venue, v.trainer_name;
end;
$$;

revoke all on function public.feedback_get_by_token(text) from public;
grant execute on function public.feedback_get_by_token(text) to anon, authenticated;

comment on function public.feedback_get_by_token(text) is
  'Resolve a public feedback token to the schedule/course the participant '
  'is being asked about. Never returns participant identity.';

-- --- Public RPC: submit feedback --------------------------------------
-- p_data is a jsonb payload validated here: ratings 1..5, nps 0..10,
-- problem category from the closed list, text length caps. Only a row still
-- in 'pending' may be submitted, so duplicates are rejected.
create or replace function public.feedback_submit(p_token text, p_data jsonb)
returns table (ok boolean, code text, message text)
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
  v_q int;
  v_nps int;
  v_vals jsonb := coalesce(p_data, '{}'::jsonb);
  v_liked text;
  v_improve text;
  v_had_problem boolean;
  v_category text;
  v_description text;
begin
  if trim(coalesce(p_token, '')) = '' then
    return query select false, 'invalid', 'Invalid feedback link.';
    return;
  end if;

  -- Validate ratings 1..5 for all ten questions.
  for v_q in 1..10 loop
    if (v_vals ->> ('q' || v_q)) is null
       or not (v_vals ->> ('q' || v_q)) ~ '^[1-5]$' then
      return query select false, 'invalid_rating', 'Please provide a rating of 1 to 5 for every question.';
      return;
    end if;
  end loop;

  -- Validate NPS 0..10 (string check first so a malformed value is rejected
  -- cleanly instead of throwing a cast exception).
  if (v_vals ->> 'nps') is null or not (v_vals ->> 'nps') ~ '^(10|[0-9])$' then
    return query select false, 'invalid_nps', 'Please provide a 0 to 10 recommendation score.';
    return;
  end if;
  v_nps := (v_vals ->> 'nps')::int;
  if v_nps < 0 or v_nps > 10 then
    return query select false, 'invalid_nps', 'Please provide a 0 to 10 recommendation score.';
    return;
  end if;

  v_liked   := left(coalesce(v_vals ->> 'liked_most', ''), 2000);
  v_improve := left(coalesce(v_vals ->> 'improve', ''), 2000);
  v_had_problem := coalesce((v_vals ->> 'had_problem')::boolean, false);
  v_category := nullif(trim(coalesce(v_vals ->> 'problem_category', '')), '');
  v_description := left(coalesce(v_vals ->> 'problem_description', ''), 2000);

  if v_had_problem and v_category is null then
    return query select false, 'invalid_category', 'Please select a problem category.';
    return;
  end if;
  if v_category is not null and v_category not in (
    'registration','trainer','training_material','practical_equipment','venue',
    'food_refreshment','schedule','assessment_examination','certificate',
    'staff_service','others'
  ) then
    return query select false, 'invalid_category', 'Invalid problem category.';
    return;
  end if;

  update public.participant_feedback
  set status = 'submitted',
      q1_score = (v_vals ->> 'q1')::smallint,
      q2_score = (v_vals ->> 'q2')::smallint,
      q3_score = (v_vals ->> 'q3')::smallint,
      q4_score = (v_vals ->> 'q4')::smallint,
      q5_score = (v_vals ->> 'q5')::smallint,
      q6_score = (v_vals ->> 'q6')::smallint,
      q7_score = (v_vals ->> 'q7')::smallint,
      q8_score = (v_vals ->> 'q8')::smallint,
      q9_score = (v_vals ->> 'q9')::smallint,
      q10_score = (v_vals ->> 'q10')::smallint,
      nps = v_nps,
      liked_most = v_liked,
      improve = v_improve,
      had_problem = v_had_problem,
      problem_category = case when v_had_problem then v_category else null end,
      problem_description = case when v_had_problem then v_description else null end,
      submitted_at = now()
  where token = trim(p_token)
    and status = 'pending'
  returning id into v_id;

  if v_id is null then
    if exists (select 1 from public.participant_feedback where token = trim(p_token)) then
      return query select false, 'duplicate', 'This feedback has already been submitted. Thank you.';
      return;
    end if;
    return query select false, 'invalid', 'Invalid feedback link.';
    return;
  end if;

  return query select true, 'submitted', 'Thank you — your feedback has been recorded.';
end;
$$;

revoke all on function public.feedback_submit(text, jsonb) from public;
grant execute on function public.feedback_submit(text, jsonb) to anon, authenticated;

comment on function public.feedback_submit(text, jsonb) is
  'Public feedback submission. Validates ratings/NPS/category, rejects '
  'duplicates (only a pending row can be submitted), never exposes identity.';

-- Retains the existing answers on the same row and permits one atomic
-- resubmission. The subsequent submit overwrites those retained answers.
create or replace function public.feedback_reopen(p_feedback_id uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
  v_email text;
begin
  if not (select app.has_min_role('editor'::public.user_role)) then
    raise exception 'Editor role required' using errcode = '42501';
  end if;

  update public.participant_feedback
  set status = 'pending', submitted_at = null
  where id = p_feedback_id and status = 'submitted'
  returning id into v_id;

  if v_id is null then return false; end if;

  select email into v_email from public.profiles where id = (select auth.uid());
  insert into public.audit_logs
    (actor_id, actor_email, action, entity_type, entity_id, summary, metadata)
  values
    ((select auth.uid()), v_email, 'update', 'participant_feedback', v_id::text,
     'Reopened feedback for resubmission',
     jsonb_build_object('previous_status', 'submitted', 'new_status', 'pending', 'answers_retained', true));

  return true;
end;
$$;

revoke all on function public.feedback_reopen(uuid) from public;
grant execute on function public.feedback_reopen(uuid) to authenticated;

-- --- Staff RPC: generate feedback links for a schedule ----------------
-- Creates one pending feedback row (with a fresh token) per eligible
-- participant (active, non-cancelled enrollment) that does not already have
-- one. Editor+ only.
create or replace function public.feedback_generate_links(p_schedule_id uuid)
returns table (created_count bigint)
language plpgsql security definer set search_path = ''
as $$
declare
  v_count bigint := 0;
begin
  if not (select app.has_min_role('editor'::public.user_role)) then return; end if;

  with new_links as (
    insert into public.participant_feedback (schedule_id, participant_id, token, status)
    select sp.schedule_id, sp.participant_id,
           'FB-' || replace(gen_random_uuid()::text, '-', ''),
           'pending'
    from public.schedule_participants sp
    join public.participants p on p.id = sp.participant_id
    where sp.schedule_id = p_schedule_id
      and sp.deleted_at is null
      and sp.registration_status <> 'cancelled'
      and p.deleted_at is null
      and not exists (
        select 1 from public.participant_feedback f
        where f.schedule_id = sp.schedule_id and f.participant_id = sp.participant_id
      )
    on conflict (schedule_id, participant_id) do nothing
    returning 1
  )
  select count(*) into v_count from new_links;

  return query select v_count;
end;
$$;

revoke all on function public.feedback_generate_links(uuid) from public;
grant execute on function public.feedback_generate_links(uuid) to authenticated;

-- --- Staff RPC: anonymised aggregate stats ----------------------------
-- The ONLY trainer-safe read path for feedback: aggregates with no identity.
-- Trainer and above may call it; anyone below gets zero rows.
create or replace function public.feedback_anonymous_stats(p_schedule_id uuid default null)
returns table (
  total_eligible bigint,
  responses bigint,
  response_rate numeric,
  avg_overall numeric,
  nps_promoters numeric,
  nps_passives numeric,
  nps_detractors numeric,
  nps numeric
)
language sql stable security definer set search_path = ''
as $$
  with eligible as (
    select sp.schedule_id, sp.participant_id
    from public.schedule_participants sp
    join public.participants p on p.id = sp.participant_id
    where (p_schedule_id is null or sp.schedule_id = p_schedule_id)
      and sp.deleted_at is null
      and sp.registration_status <> 'cancelled'
      and p.deleted_at is null
  ),
  submitted as (
    select f.*
    from public.participant_feedback f
    join eligible e on e.schedule_id = f.schedule_id and e.participant_id = f.participant_id
    where f.status = 'submitted'
  ),
  agg as (
    select
      (select count(*) from eligible) as total_eligible,
      (select count(*) from submitted) as responses,
      (select round(100.0 * count(*) / nullif((select count(*) from eligible), 0), 1)
       from submitted) as response_rate,
      (select round(avg((q1_score + q2_score + q3_score + q4_score + q5_score
                        + q6_score + q7_score + q8_score + q9_score + q10_score) / 10.0), 2)
       from submitted) as avg_overall,
      (select round(100.0 * count(*) filter (where nps between 9 and 10) / nullif(count(*), 0), 1)
       from submitted) as nps_promoters,
      (select round(100.0 * count(*) filter (where nps between 7 and 8) / nullif(count(*), 0), 1)
       from submitted) as nps_passives,
      (select round(100.0 * count(*) filter (where nps between 0 and 6) / nullif(count(*), 0), 1)
       from submitted) as nps_detractors
  )
  select agg.total_eligible, agg.responses, agg.response_rate,
         case when agg.responses >= 3 then agg.avg_overall end,
         case when agg.responses >= 3 then agg.nps_promoters end,
         case when agg.responses >= 3 then agg.nps_passives end,
         case when agg.responses >= 3 then agg.nps_detractors end,
         case when agg.responses >= 3
              then round(agg.nps_promoters - agg.nps_detractors, 1)
         end as nps
  from agg
  where (select app.has_min_role('trainer'::public.user_role));
$$;

revoke all on function public.feedback_anonymous_stats(uuid) from public;
grant execute on function public.feedback_anonymous_stats(uuid) to authenticated;

comment on function public.feedback_anonymous_stats(uuid) is
  'Trainer-safe anonymised feedback aggregates. No participant identity is '
  'ever returned; the base tables are not readable by trainers at all.';
