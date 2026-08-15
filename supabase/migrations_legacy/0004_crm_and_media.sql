-- =====================================================================
-- TERAS UNIVERSAL Admin CMS
-- Migration 0004 — CRM, Participants, Certificates & Media Library
-- =====================================================================
-- Inbound business records (enquiries, proposal requests), the people who
-- attend training (participants), issued certificates, and the single
-- media library that every module references for files.
-- =====================================================================

-- ---------------------------------------------------------------------
-- MEDIA LIBRARY (single source of truth for uploads)
-- ---------------------------------------------------------------------
create table if not exists public.media_folders (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  parent_id  uuid references public.media_folders (id) on delete cascade,
  path       text not null default '/',      -- materialised path for quick tree render
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (parent_id, name)
);

create table if not exists public.media (
  id           uuid primary key default gen_random_uuid(),
  folder_id    uuid references public.media_folders (id) on delete set null,
  kind         media_kind not null default 'image',
  bucket       text not null default 'media',
  storage_path text not null,                 -- path inside the Supabase bucket
  public_url   text,                          -- cached public URL (for public bucket)
  file_name    text not null,
  mime_type    text,
  file_size    bigint,
  width        integer,
  height       integer,
  alt_text     text,
  title        text,
  created_by   uuid references public.profiles (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  unique (bucket, storage_path)
);
create index if not exists idx_media_folder on public.media (folder_id) where deleted_at is null;
create index if not exists idx_media_kind on public.media (kind) where deleted_at is null;
create index if not exists idx_media_search on public.media using gin (to_tsvector('english', coalesce(file_name,'') || ' ' || coalesce(title,'') || ' ' || coalesce(alt_text,'')));

-- Wire up the deferred media FKs declared in migration 0003.
alter table public.courses
  add constraint fk_courses_brochure foreign key (brochure_media_id)
  references public.media (id) on delete set null;
alter table public.downloads
  add constraint fk_downloads_media foreign key (media_id)
  references public.media (id) on delete set null;
alter table public.gallery_images
  add constraint fk_gallery_media foreign key (media_id)
  references public.media (id) on delete set null;

-- ---------------------------------------------------------------------
-- MODULE 9 — ENQUIRIES (general contact form)
-- ---------------------------------------------------------------------
create table if not exists public.enquiries (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  email        citext not null,
  phone        text,
  company      text,
  subject      text,
  message      text not null,
  source       text default 'contact_form',
  status       enquiry_status not null default 'new',
  assigned_to  uuid references public.profiles (id) on delete set null,
  ip_address   inet,
  user_agent   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create index if not exists idx_enquiries_status on public.enquiries (status) where deleted_at is null;
create index if not exists idx_enquiries_assigned on public.enquiries (assigned_to);
create index if not exists idx_enquiries_created on public.enquiries (created_at desc);
create index if not exists idx_enquiries_search on public.enquiries using gin (to_tsvector('english', coalesce(name,'') || ' ' || coalesce(company,'') || ' ' || coalesce(message,'')));

-- Internal notes on an enquiry (thread of staff comments).
create table if not exists public.enquiry_notes (
  id          uuid primary key default gen_random_uuid(),
  enquiry_id  uuid not null references public.enquiries (id) on delete cascade,
  author_id   uuid references public.profiles (id) on delete set null,
  note        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_enquiry_notes_enquiry on public.enquiry_notes (enquiry_id);

-- ---------------------------------------------------------------------
-- MODULE 10 — PROPOSAL REQUESTS (maps to existing Resend proposal form)
-- ---------------------------------------------------------------------
create table if not exists public.proposal_requests (
  id             uuid primary key default gen_random_uuid(),
  company_name   text not null,
  contact_person text not null,
  job_title      text,
  email          citext not null,
  phone          text not null,
  industry       text,
  category       text,
  programme      text,
  participants   integer,
  location       text,
  preferred_month text,
  budget         text,
  objectives     text,
  notes          text,
  status         proposal_status not null default 'new',
  assigned_to    uuid references public.profiles (id) on delete set null,
  ip_address     inet,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create index if not exists idx_proposals_status on public.proposal_requests (status) where deleted_at is null;
create index if not exists idx_proposals_assigned on public.proposal_requests (assigned_to);
create index if not exists idx_proposals_created on public.proposal_requests (created_at desc);
create index if not exists idx_proposals_search on public.proposal_requests using gin (to_tsvector('english', coalesce(company_name,'') || ' ' || coalesce(contact_person,'') || ' ' || coalesce(objectives,'')));

create table if not exists public.proposal_notes (
  id          uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.proposal_requests (id) on delete cascade,
  author_id   uuid references public.profiles (id) on delete set null,
  note        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_proposal_notes_proposal on public.proposal_notes (proposal_id);

-- ---------------------------------------------------------------------
-- PARTICIPANTS (dashboard widget "Latest Participants")
-- ---------------------------------------------------------------------
create table if not exists public.participants (
  id           uuid primary key default gen_random_uuid(),
  schedule_id  uuid references public.schedules (id) on delete set null,
  full_name    text not null,
  email        citext,
  phone        text,
  company      text,
  ic_passport  text,
  status       participant_status not null default 'registered',
  registered_at timestamptz not null default now(),
  created_by   uuid references public.profiles (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create index if not exists idx_participants_schedule on public.participants (schedule_id) where deleted_at is null;
create index if not exists idx_participants_status on public.participants (status);

-- ---------------------------------------------------------------------
-- CERTIFICATES (dashboard widget "Certificate Statistics")
-- ---------------------------------------------------------------------
create table if not exists public.certificates (
  id              uuid primary key default gen_random_uuid(),
  participant_id  uuid references public.participants (id) on delete set null,
  schedule_id     uuid references public.schedules (id) on delete set null,
  course_id       uuid references public.courses (id) on delete set null,
  certificate_no  text unique,
  holder_name     text not null,
  status          certificate_status not null default 'pending',
  issued_at       date,
  expires_at      date,
  media_id        uuid references public.media (id) on delete set null,
  created_by      uuid references public.profiles (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);
create index if not exists idx_certificates_status on public.certificates (status) where deleted_at is null;
create index if not exists idx_certificates_course on public.certificates (course_id);
create index if not exists idx_certificates_issued on public.certificates (issued_at desc);
