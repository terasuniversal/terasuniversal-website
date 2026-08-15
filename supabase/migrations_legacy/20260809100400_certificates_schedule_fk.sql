-- certificates.schedule_id has existed as a plain uuid column with zero FK
-- constraint (verified live). Add the missing FK now that course_schedules
-- is the confirmed canonical schedule table certificate generation targets.
alter table public.certificates
  add constraint certificates_schedule_id_fkey
  foreign key (schedule_id) references public.course_schedules (id) on delete set null;

create index if not exists certificates_schedule_idx
  on public.certificates (schedule_id) where deleted_at is null;
