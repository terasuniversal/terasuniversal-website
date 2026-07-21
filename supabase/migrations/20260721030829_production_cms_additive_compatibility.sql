-- Additive CMS compatibility layer for the existing TERAS production schema.
-- Existing certificate-verification tables and records are never dropped, renamed or rewritten.

create extension if not exists "pg_trgm";

do $$ begin
  if not exists (select 1 from pg_type where typname='content_status') then create type public.content_status as enum ('draft','published','archived'); end if;
  if not exists (select 1 from pg_type where typname='schedule_status') then create type public.schedule_status as enum ('open','full','in_progress','completed','cancelled'); end if;
end $$;

-- Existing course rows gain CMS presentation fields without changing their
-- legacy course_code/course_name values.
alter table public.courses add column if not exists title text;
alter table public.courses add column if not exists slug text;
alter table public.courses add column if not exists category text;
alter table public.courses add column if not exists summary text;
alter table public.courses add column if not exists overview text;
alter table public.courses add column if not exists duration text;
alter table public.courses add column if not exists objectives jsonb not null default '[]'::jsonb;
alter table public.courses add column if not exists target_audience jsonb not null default '[]'::jsonb;
alter table public.courses add column if not exists requirements jsonb not null default '[]'::jsonb;
alter table public.courses add column if not exists modules jsonb not null default '[]'::jsonb;
alter table public.courses add column if not exists faq jsonb not null default '[]'::jsonb;
alter table public.courses add column if not exists hero_image_url text;
alter table public.courses add column if not exists fee numeric(10,2);
alter table public.courses add column if not exists cms_status public.content_status not null default 'draft';
alter table public.courses add column if not exists featured boolean not null default false;
alter table public.courses add column if not exists sort_order integer not null default 0;
alter table public.courses add column if not exists deleted_at timestamptz;
alter table public.courses add column if not exists created_by uuid references public.profiles(id);
alter table public.courses add column if not exists updated_by uuid references public.profiles(id);
update public.courses set title = coalesce(title, course_name), slug = coalesce(slug, lower(regexp_replace(coalesce(course_code, course_name), '[^a-zA-Z0-9]+','-','g'))), cms_status='published' where title is null or slug is null;
create index if not exists courses_cms_slug_idx on public.courses(slug) where slug is not null;

-- Separate training-session table; legacy certificates continue to use their
-- existing course link and can optionally reference a session in future.
create table if not exists public.course_schedules (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete restrict,
  trainer_name text, venue text, start_date date not null, end_date date not null,
  capacity integer not null default 0 check (capacity >= 0), seats_taken integer not null default 0 check (seats_taken >= 0 and seats_taken <= capacity),
  status public.schedule_status not null default 'open', notes text, is_published boolean not null default true,
  created_by uuid references public.profiles(id), updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  check (end_date >= start_date)
);
create index if not exists course_schedules_course_idx on public.course_schedules(course_id) where deleted_at is null;
create index if not exists course_schedules_start_idx on public.course_schedules(start_date) where deleted_at is null;

-- Additive operational fields for existing participants; legacy identity data remains untouched.
alter table public.participants add column if not exists schedule_id uuid references public.course_schedules(id) on delete set null;
alter table public.participants add column if not exists company text;
alter table public.participants add column if not exists deleted_at timestamptz;
alter table public.participants add column if not exists created_by uuid references public.profiles(id);
alter table public.participants add column if not exists updated_by uuid references public.profiles(id);
update public.participants set company=coalesce(company, organization) where company is null;
create index if not exists participants_schedule_idx on public.participants(schedule_id) where deleted_at is null;

create table if not exists public.attendance (
 id uuid primary key default gen_random_uuid(), schedule_id uuid not null references public.course_schedules(id) on delete cascade,
 participant_id uuid not null references public.participants(id) on delete cascade, session_date date not null,
 present boolean not null default false, remarks text, recorded_by uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(participant_id,session_date)
);
create table if not exists public.assessments (
 id uuid primary key default gen_random_uuid(), schedule_id uuid references public.course_schedules(id) on delete set null,
 participant_id uuid not null references public.participants(id) on delete cascade, assessment_type text, score numeric(5,2), max_score numeric(5,2) default 100,
 result text not null default 'pending' check (result in ('pending','competent','not_yet_competent','pass','fail')), assessed_at date, remarks text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

-- CMS content is deliberately separate from certificate-verification data.
create table if not exists public.cms_content (
 id uuid primary key default gen_random_uuid(), content_type text not null check(content_type in ('news','faq','testimonial','download','gallery','company','setting')),
 slug text, title text, body jsonb not null default '{}'::jsonb, status public.content_status not null default 'draft', featured boolean not null default false,
 sort_order integer not null default 0, created_by uuid references public.profiles(id), updated_by uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
 unique(content_type,slug)
);
create index if not exists cms_content_live_idx on public.cms_content(content_type,status,sort_order) where deleted_at is null;
create table if not exists public.cms_media (
 id uuid primary key default gen_random_uuid(), bucket text not null default 'media', storage_path text not null, file_name text not null, mime_type text, file_size bigint,
 public_url text, alt_text text, created_by uuid references public.profiles(id), created_at timestamptz not null default now(), deleted_at timestamptz, unique(bucket,storage_path)
);

-- RLS: CMS tables are staff-only. Public certificate verification remains on
-- the pre-existing narrowly scoped RPC and never receives table access.
do $$ declare t text; begin
 foreach t in array array['course_schedules','attendance','assessments','cms_content','cms_media'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('drop policy if exists %I on public.%I', t||'_staff_all',t);
  execute format('create policy %I on public.%I for all to authenticated using ((select app.is_editor())) with check ((select app.is_editor()))',t||'_staff_all',t);
 end loop;
end $$;

grant select,insert,update,delete on public.course_schedules,public.attendance,public.assessments,public.cms_content,public.cms_media to authenticated;
revoke all on public.course_schedules,public.attendance,public.assessments,public.cms_content,public.cms_media from anon;