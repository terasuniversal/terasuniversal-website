-- =====================================================================
-- TERAS UNIVERSAL Admin CMS
-- Migration 0002 — Core Auth, Profiles & RBAC
-- =====================================================================
-- Supabase Auth owns the `auth.users` table. We mirror each user into a
-- public `profiles` row (1:1) and attach roles + granular permissions.
-- Role helper functions live in the `app` schema and are used by every
-- RLS policy in migration 0007.
-- =====================================================================

-- --- Profiles (1:1 with auth.users) ---------------------------------
create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  email         citext not null unique,
  full_name     text,
  phone         text,
  avatar_url    text,
  job_title     text,
  role          user_role not null default 'editor',
  is_active     boolean not null default true,
  last_login_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.profiles is 'Public mirror of auth.users with role + status. One row per authenticated user.';

-- --- Granular permission overrides ----------------------------------
-- Roles give broad defaults; this table lets a Super Admin grant or
-- revoke a specific capability for a single user without changing role.
-- permission keys look like 'courses.delete', 'users.manage', etc.
create table if not exists public.user_permissions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  permission  text not null,
  granted     boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (user_id, permission)
);

comment on table public.user_permissions is 'Per-user permission overrides layered on top of role defaults.';

create index if not exists idx_user_permissions_user on public.user_permissions (user_id);

-- --- Role helper functions (SECURITY DEFINER) -----------------------
-- SECURITY DEFINER + a locked search_path lets these be called safely
-- inside RLS policies without recursive policy evaluation on profiles.
create or replace function app.current_role()
returns user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function app.is_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_active from public.profiles where id = auth.uid()), false);
$$;

create or replace function app.has_min_role(min_role user_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- Enum is declared most-privileged first, so a SMALLER ordinal = MORE power.
  select app.is_active()
     and array_position(enum_range(null::user_role), app.current_role())
       <= array_position(enum_range(null::user_role), min_role);
$$;

create or replace function app.is_super_admin() returns boolean
language sql stable security definer set search_path = public
as $$ select app.current_role() = 'super_admin' and app.is_active(); $$;

create or replace function app.is_admin() returns boolean
language sql stable security definer set search_path = public
as $$ select app.has_min_role('admin'); $$;

create or replace function app.is_editor() returns boolean
language sql stable security definer set search_path = public
as $$ select app.has_min_role('editor'); $$;

-- Effective permission = role default (editor+ can edit content) OR an
-- explicit grant, minus any explicit revoke.
create or replace function app.has_permission(perm text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when not app.is_active() then false
    when app.current_role() = 'super_admin' then true
    when exists (
      select 1 from public.user_permissions
      where user_id = auth.uid() and permission = perm and granted = false
    ) then false
    when exists (
      select 1 from public.user_permissions
      where user_id = auth.uid() and permission = perm and granted = true
    ) then true
    else app.has_min_role('editor')   -- editors and above get content perms by default
  end;
$$;

-- --- Auto-provision a profile when a new auth user is created --------
create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    coalesce((new.raw_user_meta_data ->> 'role')::user_role, 'editor')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();
