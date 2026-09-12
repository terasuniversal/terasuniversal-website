-- P3.2a: close the profile self-update privilege-escalation boundary.
--
-- Authenticated callers need to update only their own last_login_at stamp.
-- All other profile writes are performed by guarded SECURITY DEFINER RPCs or
-- the Auth trigger path. RLS remains an ownership guard, but column grants
-- provide the missing column-level authorization boundary.

revoke all on table public.profiles from anon, authenticated;
grant select on table public.profiles to authenticated;
grant update (last_login_at) on table public.profiles to authenticated;

drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);
