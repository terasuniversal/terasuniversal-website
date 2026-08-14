-- Training Schedule 2026: exam dates are assigned by an admin after the
-- training batch is planned. They are deliberately nullable and are not
-- derived from the master planner.

alter table public.course_schedules
  add column if not exists exam_date date;

comment on column public.course_schedules.exam_date is
  'Optional exam date entered by an admin. Not fixed or derived from the training planner.';
