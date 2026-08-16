-- TERAS UNIVERSAL — Staff User Management / RBAC, Phase 1
--
-- Forward-only, post-Baseline V1 migration (>= 20260817000000).
-- Idempotent/guarded. No destructive DROP. No production reset.
--
-- Adds, on top of Baseline V1 (frozen production schema):
--   1. profiles.department + access_control_enabled + updated_by
--   2. staff_module_catalog        (controlled module metadata)
--   3. staff_module_access         (explicit user × module × access_level)
--   4. SECURITY DEFINER RPCs (public schema, the PostgREST-exposed schema):
--        has_module_access / has_module_access_level / get_my_module_access
--        update_staff_profile / set_staff_module_access
--   5. last-active-super-admin protection trigger on profiles
--   6. staff audit trail (profiles + staff_module_access -> audit_logs)
--   7. RLS + grants for the two new tables
--   8. closes the self-escalation hole (authenticated may only update the
--      safe profiles columns; role/department/is_active changes go through
--      the SECURITY DEFINER update_staff_profile RPC)
--
-- Access model:
--   - profiles.role (super_admin/admin/editor/trainer/client/participant) is
--     unchanged; it remains the floor. Role-based behavior is PRESERVED for
--     every existing profile (access_control_enabled defaults false).
--   - access_control_enabled=true switches a profile to explicit module
--     grants (staff_module_access). super_admin always has every module.
--   - Staff management RPCs enforce: active caller, super_admin OR admin;
--     admin may only manage non-admin profiles (no promotion to admin/super_admin,
--     cannot modify self, cannot modify admin/super_admin profiles).
--   - The existing RLS on profiles/sales/certificates/attendance/etc. is
--     NOT modified here. Wiring module access into each module's RLS is an
--     incremental, later phase; app-layer server guards are added in this
--     branch for the staff module and the Sales leads module (integration point).

do $$
begin
  if not exists (select 1 from pg_type t where t.typname = 'staff_department') then
    create type public.staff_department as enum (
      'management', 'sales', 'marketing', 'training_operations',
      'administration', 'finance', 'hr'
    );
  end if;
end$$;

-- Audit actions for staff lifecycle events (additive).
do $$
declare
  v_label text;
begin
  foreach v_label in array array[
    'staff_created', 'staff_updated', 'staff_activated', 'staff_deactivated',
    'staff_role_changed', 'staff_department_changed', 'staff_module_access_changed'
  ] loop
    begin
      execute format('alter type public.audit_action add value if not exists %L', v_label);
    exception when duplicate_object then null;
    end;
  end loop;
end$$;

alter table public.profiles
  add column if not exists department public.staff_department,
  add column if not exists access_control_enabled boolean not null default false,
  add column if not exists updated_by uuid references public.profiles(id) on delete set null;

-- Close a pre-existing self-escalation hole: the profiles_self_update RLS
-- policy (id = auth.uid()) allows an authenticated user to change ANY column
-- of their own profile — including role. Authenticated clients may now update
-- only safe profile fields; staff role/department/is_active changes go through
-- the SECURITY DEFINER update_staff_profile RPC (which enforces the
-- admin/super_admin matrix + last-super-admin rule). Revokes are idempotent.
revoke update on public.profiles from authenticated;
grant update (full_name, phone, avatar_url, job_title, last_login_at) on public.profiles to authenticated;

create table if not exists public.staff_module_catalog (
  module_key text primary key,
  label text not null,
  group_key text not null,
  min_role public.user_role not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.staff_module_catalog is
  'Controlled CMS module keys. Role threshold and explicit staff access are separate decisions.';

insert into public.staff_module_catalog (module_key, label, group_key, min_role) values
  ('dashboard', 'Dashboard', 'overview', 'editor'),
  ('reports', 'Reports & Analytics', 'overview', 'editor'),
  ('courses', 'Courses', 'training', 'editor'),
  ('trainers', 'Trainers', 'training', 'editor'),
  ('schedules', 'Training Schedule', 'training', 'editor'),
  ('participants', 'Participants', 'training', 'editor'),
  ('companies', 'Companies', 'training', 'editor'),
  ('attendance', 'Attendance', 'training', 'trainer'),
  ('assessment', 'Assessment', 'training', 'trainer'),
  ('certificates', 'Certificates', 'certification', 'trainer'),
  ('certificate_templates', 'Certificate Templates', 'certification', 'admin'),
  ('sales', 'Sales Dashboard', 'sales', 'editor'),
  ('sales_leads', 'Leads', 'sales', 'editor'),
  ('sales_opportunities', 'Opportunities', 'sales', 'editor'),
  ('sales_quotations', 'Quotations', 'sales', 'editor'),
  ('sales_followups', 'Follow-ups', 'sales', 'editor'),
  ('sales_tasks', 'Tasks', 'sales', 'editor'),
  ('sales_reports', 'Sales Reports', 'sales', 'editor'),
  ('news', 'News', 'website', 'editor'),
  ('gallery', 'Gallery', 'website', 'editor'),
  ('faq', 'FAQ', 'website', 'editor'),
  ('downloads', 'Downloads', 'website', 'editor'),
  ('company', 'Company Profile', 'website', 'editor'),
  ('media', 'Media Library', 'website', 'editor'),
  ('automation', 'Automation Centre', 'administration', 'admin'),
  ('system', 'System Health', 'administration', 'admin'),
  ('backups', 'Backup Manager', 'administration', 'admin'),
  ('audit', 'Audit Log', 'administration', 'admin'),
  ('users', 'Staff Users', 'administration', 'admin'),
  ('feedback', 'Feedback Dashboard', 'feedback', 'editor'),
  ('feedback_responses', 'Feedback Responses', 'feedback', 'editor'),
  ('feedback_issues', 'Feedback Issues', 'feedback', 'editor'),
  ('feedback_actions', 'Feedback Actions', 'feedback', 'editor')
on conflict (module_key) do update set
  label = excluded.label,
  group_key = excluded.group_key,
  min_role = excluded.min_role,
  is_active = true;

create table if not exists public.staff_module_access (
  user_id uuid not null references public.profiles(id) on delete cascade,
  module_key text not null references public.staff_module_catalog(module_key),
  access_level text not null default 'view'
    check (access_level in ('view', 'edit', 'admin')),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  primary key (user_id, module_key)
);

comment on table public.staff_module_access is
  'Explicit module allow-list for profiles with access_control_enabled=true.';

create index if not exists staff_module_access_module_idx
  on public.staff_module_access (module_key);

-- ---------------------------------------------------------------------------
-- Module access helpers (public schema = PostgREST-exposed schema).
-- Defined BEFORE the RLS policies below that reference them.
-- ---------------------------------------------------------------------------

create or replace function public.module_access_rank(p_level text)
returns integer
language sql
immutable
set search_path = 'public'
as $$
  select case coalesce(p_level, 'none')
    when 'none' then 0
    when 'view' then 1
    when 'edit' then 2
    when 'admin' then 3
    else 0
  end;
$$;

revoke all on function public.module_access_rank(text) from public;
grant execute on function public.module_access_rank(text) to authenticated;

-- Boolean: does the current staff member have ANY access to the module?
create or replace function public.has_module_access(p_module_key text)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select case
    when not app.is_active() then false
    when app.current_role() = 'super_admin' then true
    when not coalesce((select access_control_enabled from public.profiles where id = auth.uid()), false)
      then exists (
        select 1 from public.staff_module_catalog c
        where c.module_key = p_module_key
          and c.is_active
          and app.has_min_role(c.min_role)
      )
    else exists (
      select 1 from public.staff_module_access a
      join public.staff_module_catalog c on c.module_key = a.module_key
      where a.user_id = auth.uid()
        and a.module_key = p_module_key
        and c.is_active
    )
  end;
$$;

revoke all on function public.has_module_access(text) from public;
grant execute on function public.has_module_access(text) to authenticated;

-- Level-aware variant. Legacy (role-fallback) profiles are not level-gated
-- in Phase 1; only explicit-access profiles compare access_level.
create or replace function public.has_module_access_level(p_module_key text, p_level text default 'view')
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select case
    when not public.has_module_access(p_module_key) then false
    when app.current_role() = 'super_admin' then true
    when not coalesce((select access_control_enabled from public.profiles where id = auth.uid()), false)
      then true
    else exists (
      select 1 from public.staff_module_access a
      where a.user_id = auth.uid()
        and a.module_key = p_module_key
        and public.module_access_rank(a.access_level) >= public.module_access_rank(p_level)
    )
  end;
$$;

revoke all on function public.has_module_access_level(text, text) from public;
grant execute on function public.has_module_access_level(text, text) to authenticated;

-- Returns [{module_key, access_level}] for the current staff member, used by
-- the admin shell to filter navigation (super_admin sees everything).
create or replace function public.get_my_module_access()
returns jsonb
language sql
stable
security definer
set search_path = 'public'
as $$
  select coalesce(
    jsonb_agg(jsonb_build_object('module_key', k.module_key, 'access_level', k.access_level) order by k.module_key),
    '[]'::jsonb
  )
  from (
    select c.module_key,
      case
        when app.current_role() = 'super_admin' then 'admin'
        when not coalesce((select access_control_enabled from public.profiles where id = auth.uid()), false)
          then case when app.has_min_role(c.min_role) then 'edit' else 'none' end
        else coalesce(
          (select a.access_level from public.staff_module_access a
            where a.user_id = auth.uid() and a.module_key = c.module_key),
          'none'
        )
      end as access_level
    from public.staff_module_catalog c
    where c.is_active
  ) k
  where k.access_level <> 'none';
$$;

revoke all on function public.get_my_module_access() from public;
grant execute on function public.get_my_module_access() to authenticated;

-- ---------------------------------------------------------------------------
-- RLS for the new tables
-- ---------------------------------------------------------------------------

alter table public.staff_module_catalog enable row level security;
alter table public.staff_module_access enable row level security;

drop policy if exists staff_module_catalog_staff_read on public.staff_module_catalog;
create policy staff_module_catalog_staff_read on public.staff_module_catalog
  for select to authenticated
  using (app.is_active() and is_active);

drop policy if exists staff_module_access_self_read on public.staff_module_access;
create policy staff_module_access_self_read on public.staff_module_access
  for select to authenticated
  using (user_id = auth.uid() or app.is_super_admin() or public.has_module_access('users'));

drop policy if exists staff_module_access_super_all on public.staff_module_access;
create policy staff_module_access_super_all on public.staff_module_access
  for all to authenticated
  using (app.is_super_admin())
  with check (app.is_super_admin());

revoke all on public.staff_module_catalog from anon;
revoke all on public.staff_module_access from anon;
grant select on public.staff_module_catalog to authenticated;
grant select on public.staff_module_access to authenticated;

-- ---------------------------------------------------------------------------
-- Staff management RPCs
-- ---------------------------------------------------------------------------

-- Update a staff profile (name / department / role / active). Authorization:
-- active caller; super_admin full; admin may only manage non-admin profiles
-- (cannot touch admin/super_admin profiles, cannot promote to admin/super_admin,
-- cannot modify self). The profiles RLS update path (self or super_admin) is
-- narrowed to safe columns; this RPC is the trusted path for staff management.
create or replace function public.update_staff_profile(
  p_user_id uuid,
  p_full_name text default null,
  p_department public.staff_department default null,
  p_role public.user_role default null,
  p_is_active boolean default null
)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_actor_role public.user_role;
  v_target_role public.user_role;
begin
  if not app.is_active() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_actor_role := app.current_role();

  if p_user_id is null then
    raise exception 'invalid_user' using errcode = 'P0001';
  end if;

  select role into v_target_role from public.profiles where id = p_user_id;
  if v_target_role is null then
    raise exception 'user_not_found' using errcode = 'P0001';
  end if;

  if v_actor_role <> 'super_admin' then
    if v_actor_role <> 'admin' then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    if p_user_id = auth.uid() then
      raise exception 'cannot_modify_self' using errcode = '42501';
    end if;
    if v_target_role in ('admin', 'super_admin') then
      raise exception 'forbidden_admin_target' using errcode = '42501';
    end if;
    if p_role in ('admin', 'super_admin') then
      raise exception 'forbidden_promotion' using errcode = '42501';
    end if;
  end if;

  update public.profiles
  set full_name = coalesce(nullif(trim(coalesce(p_full_name, '')), ''), full_name),
      department = coalesce(p_department, department),
      role = coalesce(p_role, role),
      is_active = coalesce(p_is_active, is_active),
      updated_by = auth.uid(),
      updated_at = now()
  where id = p_user_id;
end;
$$;

revoke all on function public.update_staff_profile(uuid, text, public.staff_department, public.user_role, boolean) from public;
grant execute on function public.update_staff_profile(uuid, text, public.staff_department, public.user_role, boolean) to authenticated;

-- Replace the explicit module grants for a profile. access_level 'none'
-- removes the module. Marks the profile access_control_enabled=true.
-- Authorization mirrors update_staff_profile.
create or replace function public.set_staff_module_access(
  p_user_id uuid,
  p_modules jsonb
)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_actor_role public.user_role;
  v_target_role public.user_role;
  v_module record;
  v_level text;
begin
  if not app.is_active() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_actor_role := app.current_role();
  if v_actor_role not in ('admin', 'super_admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_user_id is null then
    raise exception 'invalid_user' using errcode = 'P0001';
  end if;

  select role into v_target_role from public.profiles where id = p_user_id;
  if v_target_role is null then
    raise exception 'user_not_found' using errcode = 'P0001';
  end if;

  if v_actor_role <> 'super_admin' then
    if v_target_role in ('admin', 'super_admin') then
      raise exception 'forbidden_admin_target' using errcode = '42501';
    end if;
    if p_user_id = auth.uid() then
      raise exception 'cannot_modify_self' using errcode = '42501';
    end if;
  end if;

  if jsonb_typeof(p_modules) <> 'array' then
    raise exception 'invalid_modules' using errcode = 'P0001';
  end if;

  update public.profiles
  set access_control_enabled = true,
      updated_by = auth.uid(),
      updated_at = now()
  where id = p_user_id;

  delete from public.staff_module_access where user_id = p_user_id;

  for v_module in
    select * from jsonb_to_recordset(p_modules) as x(module_key text, access_level text)
  loop
    v_level := lower(trim(coalesce(v_module.access_level, 'view')));
    if v_level not in ('view', 'edit', 'admin') then
      raise exception 'invalid_access_level' using errcode = 'P0001';
    end if;
    if not exists (
      select 1 from public.staff_module_catalog c
      where c.module_key = v_module.module_key and c.is_active
    ) then
      raise exception 'invalid_module_key' using errcode = 'P0001';
    end if;
    insert into public.staff_module_access (user_id, module_key, access_level, created_by, updated_by)
    values (p_user_id, v_module.module_key, v_level, auth.uid(), auth.uid());
  end loop;
end;
$$;

revoke all on function public.set_staff_module_access(uuid, jsonb) from public;
grant execute on function public.set_staff_module_access(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Guards & audit
-- ---------------------------------------------------------------------------

-- Keep the last active Super Admin from being deactivated or demoted, even
-- through a trusted server path (service-role operations included).
create or replace function app.protect_last_super_admin()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if old.role = 'super_admin' and old.is_active
     and (new.role is distinct from old.role or new.is_active is distinct from old.is_active)
     and not exists (
       select 1 from public.profiles p
       where p.id <> old.id and p.role = 'super_admin' and p.is_active
     ) then
    raise exception 'cannot remove the last active super admin' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_protect_last_super_admin on public.profiles;
create trigger trg_profiles_protect_last_super_admin
  before update on public.profiles
  for each row execute function app.protect_last_super_admin();

-- Staff lifecycle audit trail -> existing audit_logs table (append-only).
-- Distinct actions: staff_created / staff_updated / staff_activated /
-- staff_deactivated / staff_role_changed / staff_department_changed /
-- staff_module_access_changed. Old/new captured in metadata.
create or replace function app.audit_staff_change()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_action public.audit_action;
  v_meta jsonb;
  v_email text;
  v_entity_id text;
begin
  select email into v_email from public.profiles where id = auth.uid();

  if tg_table_name = 'profiles' then
    if tg_op = 'INSERT' then
      v_action := 'staff_created';
      v_meta := jsonb_build_object('new', to_jsonb(new));
    elsif tg_op = 'UPDATE' then
      if new.is_active is distinct from old.is_active then
        v_action := case when new.is_active then 'staff_activated' else 'staff_deactivated' end;
      elsif new.role is distinct from old.role then
        v_action := 'staff_role_changed';
      elsif new.department is distinct from old.department then
        v_action := 'staff_department_changed';
      else
        v_action := 'staff_updated';
      end if;
      v_meta := jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new));
    else
      v_action := 'delete';
      v_meta := jsonb_build_object('old', to_jsonb(old));
    end if;
  elsif tg_table_name = 'staff_module_access' then
    v_action := 'staff_module_access_changed';
    if tg_op = 'INSERT' then
      v_meta := jsonb_build_object('module_key', new.module_key, 'new_level', new.access_level);
    elsif tg_op = 'UPDATE' then
      v_meta := jsonb_build_object('module_key', new.module_key, 'old_level', old.access_level, 'new_level', new.access_level);
    else
      v_meta := jsonb_build_object('module_key', old.module_key, 'old_level', old.access_level, 'new_level', 'none');
    end if;
  else
    return coalesce(new, old);
  end if;

  v_entity_id := coalesce(
    to_jsonb(new) ->> 'id',
    to_jsonb(new) ->> 'user_id',
    to_jsonb(old) ->> 'id',
    to_jsonb(old) ->> 'user_id'
  );
  insert into public.audit_logs (actor_id, actor_email, action, entity_type, entity_id, summary, metadata)
  values (auth.uid(), v_email, v_action, tg_table_name, v_entity_id, v_action, v_meta);

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_staff_audit on public.profiles;
create trigger trg_profiles_staff_audit
  after insert or update or delete on public.profiles
  for each row execute function app.audit_staff_change();

drop trigger if exists trg_staff_module_access_audit on public.staff_module_access;
create trigger trg_staff_module_access_audit
  after insert or update or delete on public.staff_module_access
  for each row execute function app.audit_staff_change();
