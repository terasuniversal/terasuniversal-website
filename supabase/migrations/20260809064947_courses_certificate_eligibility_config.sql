-- Explicit per-course certificate eligibility configuration. Confirmed via
-- live information_schema.columns inspection (2026-08-09) that none of
-- these concepts exist on public.courses today under any name.
alter table public.courses
  add column if not exists certificate_type text not null default 'completion',
  add column if not exists attendance_min_percent numeric not null default 100,
  add column if not exists assessment_required boolean not null default false,
  add column if not exists competency_required boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'courses_certificate_type_check'
  ) then
    alter table public.courses add constraint courses_certificate_type_check
      check (certificate_type in ('participation', 'completion', 'competency'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'courses_attendance_min_percent_check'
  ) then
    alter table public.courses add constraint courses_attendance_min_percent_check
      check (attendance_min_percent >= 0 and attendance_min_percent <= 100);
  end if;

  -- competency_required=true implies assessment_required=true (approved
  -- business rule §3). certificate_type itself is NOT constrained to force
  -- assessment_required, since "assessment_required should normally be
  -- true" for competency programmes is a recommendation, not an absolute --
  -- left as an app-layer default only.
  if not exists (
    select 1 from pg_constraint where conname = 'courses_competency_requires_assessment_check'
  ) then
    alter table public.courses add constraint courses_competency_requires_assessment_check
      check (not competency_required or assessment_required);
  end if;
end $$;

comment on column public.courses.certificate_type is 'participation | completion | competency -- drives v_certificate_eligibility, never inferred from category/template names.';
comment on column public.courses.attendance_min_percent is 'Minimum attendance percentage required for certificate eligibility (0-100, default 100).';
comment on column public.courses.assessment_required is 'Whether v_certificate_eligibility requires a passing assessments row before a certificate can be issued.';
comment on column public.courses.competency_required is 'Whether assessments.competency_status must equal competent in addition to result=pass. Implies assessment_required.';
