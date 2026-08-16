-- TERAS Staff Auth — First Login Password Change (Phase 2A.1)
--
-- Forward-only, post-Baseline V1 migration (>= 20260817000000). Idempotent.
--
-- Adds:
--   1. profiles.must_change_password boolean NOT NULL DEFAULT false
--      (existing users default false; new staff created through Add Staff get
--      true so they must set their own password on first login).
--   2. audit_action enum value `password_changed` (additive).
--   3. public.clear_password_change_flag()  — self-only: clears the caller's
--      own flag and records a safe audit event. Used ONLY after GoTrue
--      confirms the password update succeeded.
--   4. public.set_must_change_password(uuid, boolean) — staff-management RPC
--      (admin-gated via app.can_manage_staff) used by the Add Staff flow to
--      mark a new account as requiring a first-login password change.
--
-- Security:
--   - authenticated clients CANNOT update profiles.must_change_password
--     directly (the safe-column update grant does not include it) — the flag
--     is only cleared through the self-only RPC and only set by an authorized
--     admin via the second RPC. No bypass.
--   - Both RPCs: SECURITY DEFINER, explicit search_path=public, granted to
--     authenticated only (no anon). clear_password_change_flag has no userId
--     parameter (self-only, derived from auth.uid()).

alter table public.profiles
  add column if not exists must_change_password boolean not null default false;

do $$
declare
  v_label text;
begin
  foreach v_label in array array['password_changed'] loop
    begin
      execute format('alter type public.audit_action add value if not exists %L', v_label);
    exception when duplicate_object then null;
    end;
  end loop;
end$$;

-- Self-only clear of the first-login password-change flag. No userId is
-- accepted; the actor is always the current session user. `p_forced` is a
-- safe metadata flag (true = first-login forced change, false = voluntary
-- My Account change) recorded in the audit event — never any password.
create or replace function public.clear_password_change_flag(p_forced boolean default true)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  update public.profiles
  set must_change_password = false,
      updated_by = v_uid,
      updated_at = now()
  where id = v_uid;

  insert into public.audit_logs (actor_id, actor_email, action, entity_type, entity_id, summary, metadata)
  select v_uid, email, 'password_changed', 'profiles', v_uid::text, 'password_changed',
         jsonb_build_object('forced', coalesce(p_forced, true))
  from public.profiles
  where id = v_uid;
end;
$$;

revoke all on function public.clear_password_change_flag(boolean) from public;
grant execute on function public.clear_password_change_flag(boolean) to authenticated;

-- Admin-gated setter used by Add Staff. The caller must be a staff manager
-- (app.can_manage_staff: super_admin always, or admin with users=admin level).
create or replace function public.set_must_change_password(p_user_id uuid, p_value boolean)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if not app.is_active() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not app.can_manage_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_user_id is null then
    raise exception 'invalid_user' using errcode = 'P0001';
  end if;

  update public.profiles
  set must_change_password = coalesce(p_value, true),
      updated_by = auth.uid(),
      updated_at = now()
  where id = p_user_id;
end;
$$;

revoke all on function public.set_must_change_password(uuid, boolean) from public;
grant execute on function public.set_must_change_password(uuid, boolean) to authenticated;
