-- =====================================================================
-- TERAS UNIVERSAL Admin CMS
-- Migration 0020 — Reporting & Analytics Views
-- =====================================================================
-- Aggregate views for the reporting dashboard (monthly series, breakdowns,
-- top lists, trainer workload). All views use security_invoker so the base
-- tables' RLS applies to the querying staff member. Granted to authenticated.
-- Idempotent. Builds on all prior modules.
-- =====================================================================

-- Monthly participants (by registration date).
create or replace view public.v_participants_per_month
with (security_invoker = true) as
select to_char(registration_date, 'YYYY-MM') as ym, count(*)::int as total
from public.participants where deleted_at is null
group by 1 order by 1;

-- Monthly training sessions (courses per month, by start date).
create or replace view public.v_schedules_per_month
with (security_invoker = true) as
select to_char(start_date, 'YYYY-MM') as ym, count(*)::int as total
from public.training_schedules where deleted_at is null
group by 1 order by 1;

-- Monthly certificates issued.
create or replace view public.v_certificates_per_month
with (security_invoker = true) as
select to_char(issue_date, 'YYYY-MM') as ym, count(*)::int as total
from public.certificates where deleted_at is null and status = 'issued'
group by 1 order by 1;

-- Attendance breakdown by status.
create or replace view public.v_attendance_breakdown
with (security_invoker = true) as
select attendance_status::text as status, count(*)::int as total
from public.attendance where deleted_at is null
group by 1;

-- Monthly attendance rate (present / total).
create or replace view public.v_attendance_trend
with (security_invoker = true) as
select
  to_char(ts.start_date, 'YYYY-MM') as ym,
  count(*) filter (where a.attendance_status = 'present')::int as present,
  count(*)::int as total,
  round(100.0 * count(*) filter (where a.attendance_status = 'present') / nullif(count(*), 0), 1) as rate
from public.attendance a
join public.training_schedules ts on ts.id = a.schedule_id
where a.deleted_at is null and ts.deleted_at is null
group by 1 order by 1;

-- Assessment pass vs fail.
create or replace view public.v_assessment_passfail
with (security_invoker = true) as
select result::text as result, count(*)::int as total
from public.assessments where deleted_at is null
group by 1;

-- Top companies by participant count.
create or replace view public.v_top_companies
with (security_invoker = true) as
select c.id, c.company_name, count(p.id)::int as participant_count
from public.companies c
join public.participants p on p.company_id = c.id and p.deleted_at is null
where c.deleted_at is null
group by c.id, c.company_name
order by participant_count desc
limit 10;

-- Top courses by session count + participants.
create or replace view public.v_top_courses
with (security_invoker = true) as
select course_name,
       count(*)::int as session_count,
       coalesce(sum(registered_participants), 0)::int as participants
from public.training_schedules where deleted_at is null
group by course_name
order by session_count desc, participants desc
limit 10;

-- Trainer workload (sessions per trainer).
create or replace view public.v_trainer_workload
with (security_invoker = true) as
select t.id, t.full_name, count(ts.id)::int as session_count
from public.trainers t
left join public.training_schedules ts on ts.trainer_id = t.id and ts.deleted_at is null
where t.deleted_at is null
group by t.id, t.full_name
order by session_count desc
limit 15;

grant select on
  public.v_participants_per_month,
  public.v_schedules_per_month,
  public.v_certificates_per_month,
  public.v_attendance_breakdown,
  public.v_attendance_trend,
  public.v_assessment_passfail,
  public.v_top_companies,
  public.v_top_courses,
  public.v_trainer_workload
to authenticated;
