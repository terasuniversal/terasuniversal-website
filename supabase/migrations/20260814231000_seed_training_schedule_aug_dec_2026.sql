-- Confirmed TERAS Master Training Schedule, August-December 2026.
--
-- Course names were confirmed by the business. Schedule rows are created as
-- unpublished operational drafts: trainer, venue and exam date stay NULL for
-- an admin to assign later. Duration is not stored; the application derives it
-- from start_date/end_date for display.

insert into public.courses (
  course_code,
  course_name,
  title,
  slug,
  active,
  status,
  cms_status
)
values
  ('BSE', 'Basic Scaffolding Erector',        'Basic Scaffolding Erector',        'basic-scaffolding-erector',        true, 'draft', 'draft'),
  ('ISE', 'Intermediate Scaffolding Erector', 'Intermediate Scaffolding Erector', 'intermediate-scaffolding-erector', true, 'draft', 'draft'),
  ('ASE', 'Advanced Scaffolding Erector',     'Advanced Scaffolding Erector',     'advanced-scaffolding-erector',     true, 'draft', 'draft'),
  ('BSI', 'Basic Scaffolding Inspector',       'Basic Scaffolding Inspector',       'basic-scaffolding-inspector',       true, 'draft', 'draft'),
  ('ISI', 'Intermediate Scaffolding Inspector','Intermediate Scaffolding Inspector','intermediate-scaffolding-inspector',true, 'draft', 'draft'),
  ('ASI', 'Advanced Scaffolding Inspector',    'Advanced Scaffolding Inspector',    'advanced-scaffolding-inspector',    true, 'draft', 'draft')
on conflict (course_code) do update
set course_name = excluded.course_name,
    title = excluded.title,
    slug = coalesce(courses.slug, excluded.slug),
    active = true,
    deleted_at = null;

with planner (
  schedule_code,
  course_code,
  start_date,
  end_date,
  planner_note
) as (
  values
    ('2026-BSE-01', 'BSE', date '2026-08-09', date '2026-08-18', 'Batch Ogos'),
    ('2026-ISE-01', 'ISE', date '2026-08-09', date '2026-08-18', 'Berjalan serentak dengan BSE'),
    ('2026-BSI-01', 'BSI', date '2026-08-26', date '2026-08-27', null),
    ('2026-ISI-01', 'ISI', date '2026-08-28', date '2026-08-29', null),
    ('2026-ASI-01', 'ASI', date '2026-08-30', date '2026-08-31', '31 Ogos cuti Merdeka'),
    ('2026-BSE-02', 'BSE', date '2026-09-01', date '2026-09-10', null),
    ('2026-BSI-02', 'BSI', date '2026-09-07', date '2026-09-08', null),
    ('2026-ISI-02', 'ISI', date '2026-09-09', date '2026-09-10', null),
    ('2026-ASI-02', 'ASI', date '2026-09-11', date '2026-09-12', null),
    ('2026-ISE-02', 'ISE', date '2026-09-14', date '2026-09-23', '16 Sep Hari Malaysia'),
    ('2026-ASE-01', 'ASE', date '2026-09-24', date '2026-10-03', 'Cross-month'),
    ('2026-BSI-03', 'BSI', date '2026-10-04', date '2026-10-05', null),
    ('2026-BSE-03', 'BSE', date '2026-10-04', date '2026-10-13', null),
    ('2026-ISI-03', 'ISI', date '2026-10-06', date '2026-10-07', null),
    ('2026-ASI-03', 'ASI', date '2026-10-08', date '2026-10-09', null),
    ('2026-ISE-03', 'ISE', date '2026-10-15', date '2026-10-24', null),
    ('2026-ASE-02', 'ASE', date '2026-10-25', date '2026-11-03', 'Cross-month'),
    ('2026-BSE-04', 'BSE', date '2026-11-04', date '2026-11-13', '8 Nov Deepavali'),
    ('2026-BSI-04', 'BSI', date '2026-11-15', date '2026-11-16', null),
    ('2026-ISE-04', 'ISE', date '2026-11-15', date '2026-11-24', 'Serentak dengan BSI/ISI/ASI'),
    ('2026-ISI-04', 'ISI', date '2026-11-17', date '2026-11-18', null),
    ('2026-ASI-04', 'ASI', date '2026-11-19', date '2026-11-20', null),
    ('2026-ASE-03', 'ASE', date '2026-11-25', date '2026-12-04', 'Cross-month'),
    ('2026-BSI-05', 'BSI', date '2026-12-06', date '2026-12-07', null),
    ('2026-BSE-05', 'BSE', date '2026-12-06', date '2026-12-15', null),
    ('2026-ISI-05', 'ISI', date '2026-12-08', date '2026-12-09', null),
    ('2026-ASI-05', 'ASI', date '2026-12-10', date '2026-12-11', null),
    ('2026-ISE-05', 'ISE', date '2026-12-15', date '2026-12-24', 'Trainer berasingan'),
    ('2026-ASE-04', 'ASE', date '2026-12-15', date '2026-12-24', 'Trainer berasingan daripada ISE')
)
insert into public.course_schedules (
  schedule_code,
  course_id,
  trainer_name,
  venue,
  start_date,
  end_date,
  exam_date,
  capacity,
  status,
  notes,
  is_published
)
select
  planner.schedule_code,
  courses.id,
  null,
  null,
  planner.start_date,
  planner.end_date,
  null,
  0,
  'open',
  concat_ws(' — ', 'Master Training Schedule Aug-Dec 2026', planner.planner_note),
  false
from planner
join public.courses on courses.course_code = planner.course_code
on conflict do nothing;
