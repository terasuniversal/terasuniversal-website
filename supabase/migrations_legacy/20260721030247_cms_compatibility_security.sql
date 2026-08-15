-- Audited compatibility migration for the existing TERAS Certificate Verification schema.
-- It preserves the existing certificate, participant and course records and their RLS model.

create extension if not exists "citext";
create schema if not exists app;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type public.user_role as enum ('super_admin','admin','editor','trainer','client','participant');
  end if;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email citext not null unique,
  full_name text,
  phone text,
  avatar_url text,
  job_title text,
  role public.user_role not null default 'editor',
  is_active boolean not null default true,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Roles are server-controlled. New users always begin as editors; their role
-- is never read from user-editable Auth metadata.
create or replace function app.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, auth as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'), 'editor')
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke all on function app.handle_new_user() from public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function app.handle_new_user();

-- Backfill the already-created Auth administrator and make the pre-existing
-- admin_users membership authoritative for the first CMS administrator.
insert into public.profiles (id, email, full_name, role, is_active)
select u.id, u.email, coalesce(a.display_name, u.email), 'super_admin'::public.user_role, true
from public.admin_users a join auth.users u on u.id = a.user_id
on conflict (id) do update set role = 'super_admin', is_active = true;

create or replace function app.current_role() returns public.user_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = (select auth.uid());
$$;
create or replace function app.is_active() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_active from public.profiles where id = (select auth.uid())), false);
$$;
create or replace function app.has_min_role(min_role public.user_role) returns boolean
language sql stable security definer set search_path = public as $$
  select app.is_active() and array_position(enum_range(null::public.user_role), app.current_role())
    <= array_position(enum_range(null::public.user_role), min_role);
$$;
create or replace function app.is_super_admin() returns boolean
language sql stable security definer set search_path = public as $$ select app.current_role() = 'super_admin' and app.is_active(); $$;
create or replace function app.is_admin() returns boolean
language sql stable security definer set search_path = public as $$ select app.has_min_role('admin'::public.user_role); $$;
create or replace function app.is_editor() returns boolean
language sql stable security definer set search_path = public as $$ select app.has_min_role('editor'::public.user_role); $$;
revoke all on function app.current_role() from public;
revoke all on function app.is_active() from public;
revoke all on function app.has_min_role(public.user_role) from public;
revoke all on function app.is_super_admin() from public;
revoke all on function app.is_admin() from public;
revoke all on function app.is_editor() from public;
grant usage on schema app to authenticated;
grant execute on function app.current_role(), app.is_active(), app.has_min_role(public.user_role), app.is_super_admin(), app.is_admin(), app.is_editor() to authenticated;

-- Every public table remains RLS-protected. Existing restrictive policies on
-- certificates, participants and courses are deliberately preserved.
do $$ declare t text; begin
  foreach t in array array['profiles','admin_users','certificate_import_logs','certificates','participants','courses'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

create index if not exists certificate_import_logs_created_by_idx on public.certificate_import_logs(created_by);

-- Profiles: staff can read only their own profile; only super-admin may change roles.
drop policy if exists profiles_self_select on public.profiles;
drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select app.is_admin()));
create policy profiles_self_update on public.profiles for update to authenticated
  using (id = (select auth.uid()) or (select app.is_super_admin()))
  with check (id = (select auth.uid()) or (select app.is_super_admin()));

-- No password column is created in public. Auth owns credentials in auth.users.