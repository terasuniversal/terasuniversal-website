-- Disposable-database fixture only, loaded on top of c4_wah_production_baseline.sql.
-- Adds the columns, tables and foreign keys the real legacy functions and the schedule
-- guard touch, trimmed from supabase/baseline/v3/schema.sql. The two legacy function
-- bodies themselves are loaded from their migrations by the test, not restated here.
alter table public.participants
  add column identity_no text, add column identity_last4 text, add column status text,
  add column deleted_at timestamptz, add column legacy_batch_id uuid;
alter table public.course_schedules
  add column capacity int, add column is_published boolean default false, add column notes text, add column legacy_batch_id uuid;
alter table public.schedule_participants
  add column id uuid primary key default gen_random_uuid(), add column legacy_batch_id uuid;

create table public.legacy_import_batches (
  id uuid primary key default gen_random_uuid(), status text not null default 'uploaded'
);
create table public.legacy_participant_staging (
  id uuid primary key default gen_random_uuid(), batch_id uuid not null references public.legacy_import_batches(id), source_row_number int not null default 1,
  raw_name text, raw_ic_passport text, normalized_ic_passport text, raw_company text, raw_course_name text, training_start_date date, training_end_date date, raw_certificate_number text,
  matched_participant_id uuid, mapped_course_id uuid, match_status text, review_status text not null default 'pending', validation_error text,
  result_participant_id uuid, result_schedule_id uuid, result_enrollment_id uuid, result_certificate_id uuid, merge_error text, merged_at timestamptz
);
create function public.log_event_as_service(p_actor uuid, p_email text, p_action audit_action, p_entity_type text, p_entity_id text, p_summary text, p_metadata jsonb)
  returns void language sql as $$ insert into public.audit_logs (actor_id, actor_email, action, entity_type, entity_id, summary, metadata) values (p_actor, p_email, p_action, p_entity_type, p_entity_id, p_summary, p_metadata) $$;

-- The delete actions the schedule guard exists to contain, as in the baseline.
alter table public.participant_skill_results add foreign key (schedule_id) references public.course_schedules(id) on delete cascade;
alter table public.schedule_participants add foreign key (schedule_id) references public.course_schedules(id) on delete cascade;
alter table public.attendance add foreign key (schedule_id) references public.course_schedules(id) on delete cascade;
alter table public.certificates drop constraint certificates_schedule_id_fkey;
alter table public.certificates add constraint certificates_schedule_id_fkey foreign key (schedule_id) references public.course_schedules(id) on delete set null;
