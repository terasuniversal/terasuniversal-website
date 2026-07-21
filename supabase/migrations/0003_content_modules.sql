-- =====================================================================
-- TERAS UNIVERSAL Admin CMS
-- Migration 0003 — Content Modules
-- =====================================================================
-- Public-facing content the website renders: courses, schedules (with
-- trainers + venues), downloads, news, gallery, faq, testimonials, plus
-- the singleton company profile and site settings.
--
-- Conventions used everywhere:
--   * uuid primary keys (gen_random_uuid())
--   * created_at / updated_at timestamptz (updated_at maintained by trigger)
--   * deleted_at timestamptz  → soft delete (NULL = live)
--   * created_by / updated_by → profiles(id)
--   * content_status enum for anything with a publish lifecycle
-- =====================================================================

-- Shared audit columns are added inline per table (Postgres has no table
-- inheritance macro we want to rely on for RLS clarity).

-- ---------------------------------------------------------------------
-- MODULE 1 — COURSES
-- ---------------------------------------------------------------------
create table if not exists public.courses (
  id             uuid primary key default gen_random_uuid(),
  title          text not null,
  slug           text not null unique,
  category       text,
  summary        text,
  overview       text,
  objectives     jsonb not null default '[]'::jsonb,   -- string[]
  duration       text,
  delivery_modes course_delivery_mode[] not null default '{}',
  target_audience jsonb not null default '[]'::jsonb,  -- string[]
  requirements   jsonb not null default '[]'::jsonb,   -- string[]
  modules        jsonb not null default '[]'::jsonb,   -- [{title, items?}]
  faq            jsonb not null default '[]'::jsonb,    -- [{q,a}]
  brochure_media_id uuid,                               -- FK added in 0004 (media)
  hero_image_url text,
  fee            numeric(10,2),
  status         content_status not null default 'draft',
  featured       boolean not null default false,
  sort_order     integer not null default 0,
  seo_title      text,
  seo_description text,
  seo_keywords   jsonb not null default '[]'::jsonb,
  published_at   timestamptz,
  created_by     uuid references public.profiles (id),
  updated_by     uuid references public.profiles (id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create index if not exists idx_courses_status on public.courses (status) where deleted_at is null;
create index if not exists idx_courses_slug on public.courses (slug);
create index if not exists idx_courses_category on public.courses (category);
create index if not exists idx_courses_search on public.courses using gin (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(summary,'') || ' ' || coalesce(overview,'')));

-- ---------------------------------------------------------------------
-- MODULE 2 — TRAINING SCHEDULE (+ trainers, venues)
-- ---------------------------------------------------------------------
create table if not exists public.trainers (
  id          uuid primary key default gen_random_uuid(),
  full_name   text not null,
  email       citext,
  phone       text,
  bio         text,
  photo_url   text,
  specialties jsonb not null default '[]'::jsonb,
  profile_id  uuid references public.profiles (id),  -- optional link to a login
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create table if not exists public.venues (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  address     text,
  city        text,
  state       text,
  capacity    integer,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create table if not exists public.schedules (
  id            uuid primary key default gen_random_uuid(),
  course_id     uuid not null references public.courses (id) on delete cascade,
  trainer_id    uuid references public.trainers (id) on delete set null,
  venue_id      uuid references public.venues (id) on delete set null,
  venue_text    text,                       -- free-text fallback when no venue row
  start_date    date not null,
  end_date      date not null,
  start_time    time,
  end_time      time,
  capacity      integer not null default 0,
  seats_taken   integer not null default 0,
  status        schedule_status not null default 'open',
  fee           numeric(10,2),
  notes         text,
  is_published  boolean not null default true,
  created_by    uuid references public.profiles (id),
  updated_by    uuid references public.profiles (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  constraint chk_schedule_dates check (end_date >= start_date),
  constraint chk_schedule_seats check (seats_taken >= 0 and seats_taken <= capacity)
);
create index if not exists idx_schedules_course on public.schedules (course_id) where deleted_at is null;
create index if not exists idx_schedules_start on public.schedules (start_date) where deleted_at is null;
create index if not exists idx_schedules_status on public.schedules (status);

-- Convenience generated column: seats still available.
alter table public.schedules
  add column if not exists seats_available integer
  generated always as (greatest(capacity - seats_taken, 0)) stored;

-- ---------------------------------------------------------------------
-- MODULE 3 — DOWNLOADS
-- ---------------------------------------------------------------------
create table if not exists public.downloads (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  slug         text unique,
  description  text,
  category     text,                         -- Company Profile, Brochure, Registration Form, Training Calendar, Safety Guide, Other
  media_id     uuid,                         -- FK added in 0004
  file_url     text,                         -- denormalised public URL for quick render
  file_size    bigint,
  download_count integer not null default 0,
  status       content_status not null default 'published',
  sort_order   integer not null default 0,
  created_by   uuid references public.profiles (id),
  updated_by   uuid references public.profiles (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create index if not exists idx_downloads_category on public.downloads (category) where deleted_at is null;

-- ---------------------------------------------------------------------
-- MODULE 4 — NEWS
-- ---------------------------------------------------------------------
create table if not exists public.news_categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text not null unique,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.news_posts (
  id             uuid primary key default gen_random_uuid(),
  title          text not null,
  slug           text not null unique,
  excerpt        text,
  body           text,                       -- rich text / markdown
  category_id    uuid references public.news_categories (id) on delete set null,
  featured_image_url text,
  featured       boolean not null default false,
  status         content_status not null default 'draft',
  scheduled_for  timestamptz,                -- when status = scheduled
  published_at   timestamptz,
  seo_title      text,
  seo_description text,
  author_id      uuid references public.profiles (id),
  created_by     uuid references public.profiles (id),
  updated_by     uuid references public.profiles (id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create index if not exists idx_news_status on public.news_posts (status) where deleted_at is null;
create index if not exists idx_news_published on public.news_posts (published_at desc) where deleted_at is null;
create index if not exists idx_news_search on public.news_posts using gin (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(excerpt,'') || ' ' || coalesce(body,'')));

-- ---------------------------------------------------------------------
-- MODULE 5 — GALLERY
-- ---------------------------------------------------------------------
create table if not exists public.gallery_categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text not null unique,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.gallery_images (
  id           uuid primary key default gen_random_uuid(),
  title        text,
  alt_text     text not null default '',
  media_id     uuid,                         -- FK added in 0004
  image_url    text not null,
  category_id  uuid references public.gallery_categories (id) on delete set null,
  featured     boolean not null default false,
  status       content_status not null default 'published',
  sort_order   integer not null default 0,
  created_by   uuid references public.profiles (id),
  updated_by   uuid references public.profiles (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create index if not exists idx_gallery_category on public.gallery_images (category_id) where deleted_at is null;
create index if not exists idx_gallery_featured on public.gallery_images (featured) where deleted_at is null;

-- ---------------------------------------------------------------------
-- MODULE 6 — FAQ
-- ---------------------------------------------------------------------
create table if not exists public.faq_categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text not null unique,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.faqs (
  id           uuid primary key default gen_random_uuid(),
  question     text not null,
  answer       text not null,
  category_id  uuid references public.faq_categories (id) on delete set null,
  status       content_status not null default 'published',
  sort_order   integer not null default 0,
  created_by   uuid references public.profiles (id),
  updated_by   uuid references public.profiles (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create index if not exists idx_faqs_category on public.faqs (category_id) where deleted_at is null;

-- ---------------------------------------------------------------------
-- MODULE 7 — TESTIMONIALS
-- ---------------------------------------------------------------------
create table if not exists public.testimonials (
  id            uuid primary key default gen_random_uuid(),
  company_name  text,
  author_name   text,
  author_title  text,
  logo_url      text,
  photo_url     text,
  quote         text not null,
  rating        smallint check (rating between 1 and 5),
  status        content_status not null default 'draft',
  featured      boolean not null default false,
  sort_order    integer not null default 0,
  created_by    uuid references public.profiles (id),
  updated_by    uuid references public.profiles (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create index if not exists idx_testimonials_status on public.testimonials (status) where deleted_at is null;

-- ---------------------------------------------------------------------
-- MODULE 8 — COMPANY PROFILE (singleton)
-- ---------------------------------------------------------------------
create table if not exists public.company_profile (
  id            integer primary key default 1,
  legal_name    text,
  tagline       text,
  about         text,
  vision        text,
  mission       text,
  services      jsonb not null default '[]'::jsonb,
  phone         text,
  email_training citext,
  email_admin   citext,
  address       text,
  city          text,
  state         text,
  postcode      text,
  country       text default 'Malaysia',
  google_map_embed text,
  whatsapp      text,
  social_media  jsonb not null default '{}'::jsonb,   -- {facebook, linkedin, instagram, ...}
  updated_by    uuid references public.profiles (id),
  updated_at    timestamptz not null default now(),
  constraint company_profile_singleton check (id = 1)
);

-- ---------------------------------------------------------------------
-- MODULE 12 — SETTINGS (key/value)
-- ---------------------------------------------------------------------
create table if not exists public.site_settings (
  key         text primary key,
  value       jsonb not null default '{}'::jsonb,
  description text,
  is_public   boolean not null default false,   -- true = safe to expose to the browser
  updated_by  uuid references public.profiles (id),
  updated_at  timestamptz not null default now()
);
comment on table public.site_settings is 'Namespaced key/value config: seo, logo, favicon, contact, email, whatsapp, analytics IDs.';
