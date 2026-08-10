-- Adds the generation-safety gate (certificate_generation_enabled +
-- certificate_template_id) on top of the eligibility engine created in the
-- prior migration. An unconfigured course must never become "eligible"
-- just because attendance/schedule/assessment happen to pass -- generation
-- is opt-in and template-bound per course, full stop.
--
-- New columns are appended at the end of the SELECT list, not inserted
-- mid-list: CREATE OR REPLACE VIEW forbids changing the name/position of
-- existing output columns (42P16), only appending new ones is allowed.
create or replace view public.v_certificate_eligibility
with (security_invoker = true) as
with enrollment as (
  select schedule_id, participant_id, registration_status as enrollment_status
  from public.schedule_participants
  where deleted_at is null
),
attendance_agg as (
  select
    schedule_id,
    participant_id,
    count(*) filter (where attendance_status = 'present') as present_days,
    count(*) filter (where attendance_status = 'late') as late_days,
    count(*) filter (where attendance_status = 'absent') as absent_days,
    count(*) filter (where attendance_status = 'excused') as excused_days,
    count(distinct session_date) as attendance_days
  from public.attendance
  where deleted_at is null
  group by schedule_id, participant_id
),
assessment_row as (
  select schedule_id, participant_id, result, competency_status, theory_score, practical_score
  from public.assessments
  where deleted_at is null
),
existing_cert as (
  select distinct on (schedule_id, participant_id)
    schedule_id, participant_id, id as certificate_id, certificate_number
  from public.certificates
  where deleted_at is null and schedule_id is not null and status <> 'revoked'
  order by schedule_id, participant_id, created_at desc
),
joined as (
  select
    e.schedule_id,
    cs.schedule_code,
    e.participant_id,
    cs.course_id,
    coalesce(co.title, co.course_name) as course_name,
    co.course_code,
    p.full_name as holder_name,
    e.enrollment_status,
    cs.status::text as schedule_status,
    cs.start_date as schedule_start_date,
    cs.end_date as schedule_end_date,
    cs.venue,
    cs.trainer_name,
    coalesce(att.present_days, 0) as present_days,
    coalesce(att.late_days, 0) as late_days,
    coalesce(att.absent_days, 0) as absent_days,
    coalesce(att.excused_days, 0) as excused_days,
    coalesce(att.attendance_days, 0) as attendance_days,
    co.certificate_type,
    co.attendance_min_percent,
    co.assessment_required,
    co.competency_required,
    co.certificate_generation_enabled,
    co.certificate_template_id,
    (ar.schedule_id is not null) as assessment_row_exists,
    ar.result,
    ar.competency_status,
    ar.theory_score,
    ar.practical_score,
    ec.certificate_id as existing_certificate_id,
    ec.certificate_number as existing_certificate_number,
    (cs.end_date - cs.start_date + 1)::int as calendar_expected_days
  from enrollment e
  join public.course_schedules cs on cs.id = e.schedule_id and cs.deleted_at is null
  join public.courses co on co.id = cs.course_id
  join public.participants p on p.id = e.participant_id
  left join attendance_agg att on att.schedule_id = e.schedule_id and att.participant_id = e.participant_id
  left join assessment_row ar on ar.schedule_id = e.schedule_id and ar.participant_id = e.participant_id
  left join existing_cert ec on ec.schedule_id = e.schedule_id and ec.participant_id = e.participant_id
),
computed as (
  select
    j.*,
    greatest(j.calendar_expected_days - j.excused_days, 0) as effective_expected_days,
    (j.present_days + j.late_days) as attended_days
  from joined j
),
metrics as (
  select
    c.*,
    case when c.effective_expected_days <= 0 then 100
         else round(c.attended_days * 100.0 / c.effective_expected_days, 2)
    end as attendance_percentage
  from computed c
),
final as (
  select
    m.*,
    (m.attendance_percentage >= m.attendance_min_percent) as attendance_satisfied,
    case
      when not m.assessment_required then true
      when not m.assessment_row_exists then false
      when m.result is distinct from 'pass' then false
      when m.competency_required and coalesce(m.competency_status, '') <> 'competent' then false
      else true
    end as assessment_satisfied
  from metrics m
)
select
  f.schedule_id,
  f.schedule_code,
  f.participant_id,
  f.course_id,
  f.course_name,
  f.course_code,
  f.holder_name,
  f.enrollment_status,
  f.schedule_status,
  f.schedule_start_date,
  f.schedule_end_date,
  f.venue,
  f.trainer_name,
  f.calendar_expected_days,
  f.attendance_days,
  f.present_days,
  f.late_days,
  f.absent_days,
  f.excused_days,
  f.effective_expected_days,
  f.attended_days,
  f.attendance_percentage,
  f.attendance_min_percent,
  f.attendance_satisfied,
  f.certificate_type,
  f.assessment_required,
  f.competency_required,
  f.assessment_row_exists,
  f.result,
  f.competency_status,
  f.theory_score,
  f.practical_score,
  f.assessment_satisfied,
  f.existing_certificate_id,
  f.existing_certificate_number,
  (
    f.certificate_generation_enabled
    and f.certificate_template_id is not null
    and f.enrollment_status <> 'cancelled'
    and f.schedule_status = 'completed'
    and f.attendance_satisfied
    and f.assessment_satisfied
    and f.existing_certificate_id is null
  ) as eligible,
  case
    when not f.certificate_generation_enabled then 'certificate_generation_disabled'
    when f.certificate_template_id is null then 'certificate_template_not_configured'
    when f.enrollment_status = 'cancelled' then 'enrollment_cancelled'
    when f.schedule_status <> 'completed' then 'schedule_not_completed'
    when not f.attendance_satisfied then 'attendance_not_met'
    when f.assessment_required and not f.assessment_row_exists then 'assessment_missing'
    when f.assessment_required and f.result is distinct from 'pass' then 'assessment_not_passed'
    when f.assessment_required and f.competency_required and coalesce(f.competency_status, '') <> 'competent' then 'competency_not_met'
    when f.existing_certificate_id is not null then 'certificate_already_exists'
    else null
  end as ineligibility_reason,
  f.certificate_generation_enabled,
  f.certificate_template_id
from final f;

grant select on public.v_certificate_eligibility to authenticated;
revoke all on public.v_certificate_eligibility from anon;
