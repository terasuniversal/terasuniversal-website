-- Run after certificates.sql if the main migration was already applied.
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

alter table public.certificate_import_logs enable row level security;
grant insert, select on public.certificate_import_logs to authenticated;

drop policy if exists "Admins can read import logs" on public.certificate_import_logs;
create policy "Admins can read import logs" on public.certificate_import_logs for select to authenticated
using (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())));

drop policy if exists "Admins can create import logs" on public.certificate_import_logs;
create policy "Admins can create import logs" on public.certificate_import_logs for insert to authenticated
with check (created_by = (select auth.uid()) and exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())));
