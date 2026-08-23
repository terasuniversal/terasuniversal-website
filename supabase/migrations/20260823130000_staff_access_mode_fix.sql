-- TERAS Staff User Management — P0 fix: explicit access mode
--
-- Forward-only, additive migration. Fixes a confirmed P0: access_control_enabled
-- had no supported "turn off" path, and set_staff_module_access() unconditionally
-- set it true (even for an empty module list) while also deleting every existing
-- staff_module_access row for the target -- a normal "uncheck all modules" edit
-- could silently and irreversibly lock a staff member out of every module, with
-- no UI warning and no self-service recovery.
--
-- Fix, in two parts:
--
--   1. update_staff_profile gains a 6th parameter, p_access_control_enabled,
--      so an authorized admin can explicitly set Role Default (false) or
--      Custom (true) access mode. This is a signature change (Postgres treats
--      a different parameter list as a distinct function), so the old 5-arg
--      version is dropped first and exactly one 6-arg version exists after.
--      All existing guards are preserved unchanged: app.is_active(),
--      app.can_manage_staff(), the admin role-floor rules (no admin/
--      super_admin target, no promotion, no self-modification for non-super
--      admins), and app.protect_last_super_admin() (a separate BEFORE UPDATE
--      trigger on profiles, untouched by this migration). trg_profiles_staff_audit
--      still fires automatically on the same UPDATE -- no change needed there.
--
--   2. set_staff_module_access no longer touches access_control_enabled at
--      all -- that flag is now set explicitly and only by update_staff_profile,
--      by the caller's own choice of access mode, never inferred from what
--      module keys happen to be submitted. It also now rejects an empty
--      module list outright (new `empty_modules` error) instead of silently
--      accepting it and deleting every row -- Custom mode must have at least
--      one module; Role Default mode should never call this RPC at all (see
--      app/admin/(protected)/users/actions.ts's updated call sites).
--
-- Data decision (unchanged from the prior, never-shipped analysis of this
-- gap): switching access_control_enabled true -> false does NOT delete
-- staff_module_access rows. Every read-side function
-- (has_module_access/has_module_access_level/get_my_module_access) already
-- gates on access_control_enabled FIRST and falls back to role-default
-- behavior when it's false, ignoring any existing staff_module_access rows --
-- so flipping the flag alone is sufficient to restore role-default access,
-- and switching back to Custom later reactivates the preserved rows with no
-- backfill needed. No changes to those read-side functions are required or
-- made here.
--
-- Security unchanged: both functions remain SECURITY DEFINER, search_path=public,
-- same app.can_manage_staff() gate, same admin role-floor rules, same audit
-- path (existing triggers, no manual audit call added).

drop function if exists public.update_staff_profile(uuid, text, public.staff_department, public.user_role, boolean);

create or replace function public.update_staff_profile(
  p_user_id uuid,
  p_full_name text default null,
  p_department public.staff_department default null,
  p_role public.user_role default null,
  p_is_active boolean default null,
  p_access_control_enabled boolean default null
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
  if not app.can_manage_staff() then
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
      access_control_enabled = coalesce(p_access_control_enabled, access_control_enabled),
      updated_by = auth.uid(),
      updated_at = now()
  where id = p_user_id;
end;
$$;

revoke all on function public.update_staff_profile(uuid, text, public.staff_department, public.user_role, boolean, boolean) from public;
grant execute on function public.update_staff_profile(uuid, text, public.staff_department, public.user_role, boolean, boolean) to authenticated;

create or replace function public.set_staff_module_access(p_user_id uuid, p_modules jsonb)
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
  if not app.can_manage_staff() then
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
  -- Custom-mode module lists must be non-empty -- an empty list here used to
  -- mean "wipe every grant while access_control_enabled stays/becomes true",
  -- which is exactly the unrecoverable-lockout shape this migration fixes.
  -- Role Default mode should never reach this RPC at all (the caller skips
  -- it); Custom mode with zero modules is a caller-side validation error.
  if jsonb_array_length(p_modules) = 0 then
    raise exception 'empty_modules' using errcode = 'P0001';
  end if;

  -- access_control_enabled is no longer touched here -- it is set only by
  -- update_staff_profile's p_access_control_enabled, an explicit admin
  -- choice, never inferred from the shape of this call's payload.

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
