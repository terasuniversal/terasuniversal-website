-- TERAS UNIVERSAL certificate system migration.
-- This migration extends the existing public.certificates table.
-- It is already applied to the configured Supabase project.

create extension if not exists pgcrypto;

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.certificate_import_logs (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete restrict,
  source text not null default 'csv' check (source in ('csv', 'pdf')),
  source_file_count integer not null default 0,
  row_count integer not null default 0,
  imported_count integer not null default 0,
  skipped_count integer not null default 0,
  error_count integer not null default 0,
  status text not null default 'completed' check (status in ('completed', 'partial', 'failed')),
  error_summary jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.certificates add column if not exists identity_no text;
alter table public.certificates add column if not exists instructor text;
alter table public.certificates add column if not exists certificate_file_url text;
alter table public.certificates add column if not exists public_verification_enabled boolean not null default true;

create index if not exists certificates_identity_no_idx on public.certificates (identity_no);

alter table public.admin_users enable row level security;
alter table public.certificates enable row level security;
alter table public.participants enable row level security;
alter table public.courses enable row level security;

grant select on public.admin_users to authenticated;
grant select on public.certificates to anon, authenticated;
grant insert, update, delete on public.certificates to authenticated;
grant insert, update on public.participants to authenticated;
grant insert, update on public.courses to authenticated;

-- Admin membership is deliberately separate from user-editable metadata.
create policy "Admins can read admin membership" on public.admin_users for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Public can verify certificates" on public.certificates for select to anon, authenticated
using (public_verification_enabled = true);

create policy "Admins can read all certificates" on public.certificates for select to authenticated
using (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())));

create policy "Admins can insert certificates" on public.certificates for insert to authenticated
with check (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())));

create policy "Admins can update certificates" on public.certificates for update to authenticated
using (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())))
with check (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())));

create policy "Admins can delete certificates" on public.certificates for delete to authenticated
using (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())));

create policy "Admins can manage participants" on public.participants for all to authenticated
using (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())))
with check (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())));

create policy "Admins can manage courses" on public.courses for all to authenticated
using (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())))
with check (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())));

-- After creating an Email/Password admin in Supabase Auth:
-- insert into public.admin_users (user_id, display_name) values ('AUTH-USER-UUID', 'TERAS Admin');
