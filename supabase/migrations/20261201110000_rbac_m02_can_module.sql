-- RBAC M-02: one central capability check for module-scoped staff operations.
--
-- app.can_module(p_module, p_level) is true only when ALL hold:
--   1. p_level is one of view | edit | admin (anything else, including NULL, is false);
--   2. p_module is an existing, active row in public.staff_module_catalog (unknown or retired modules are false,
--      even for super_admin - public.has_module_access returns true for any key for super_admin, this does not);
--   3. the caller is an authenticated, active staff account (app.is_active());
--   4. role eligibility: admin or super_admin, OR an editor whose profile has access_control_enabled = true
--      (Custom Module Access). An editor on Role Default Access - the catalog-floor fallback - is NOT eligible, so the
--      editor role alone never confers anything here. Trainer and below are never eligible;
--   5. public.has_module_access_level(p_module, p_level) - the existing grant model (explicit staff_module_access row at
--      or above the level for Custom profiles; super_admin always).
-- Any NULL along the way yields false (fail closed).
--
-- For an admin this equals app.is_admin() AND has_module_access_level(m, l) on every active catalog module and level,
-- i.e. the expression the Sales/Finance policies and *_unguarded gates use today (0 differences in 120 checks per
-- Production admin persona, rolled-back simulation 2026-11-24). It is therefore safe to substitute for admins.
--
-- SECURITY DEFINER (owner postgres) with a fixed search_path so it can read profiles/catalog regardless of the caller's
-- table privileges; it reads auth.uid() from the request JWT, so it always evaluates the caller, also when invoked from
-- inside other SECURITY DEFINER functions. EXECUTE: authenticated only (policies are evaluated as authenticated;
-- service_role bypasses RLS and has no auth.uid()).
-- Not used by anything until M-04/M-05; creating it changes no behaviour.
-- Rollback: docs/security/crm-rbac/20261201110000_rbac_m02_can_module.rollback.sql
-- Approval: OWNER-CRM-RBAC-DEV-20261124 (local development; not applied anywhere).

set local lock_timeout = '5s';

do $m02_pre$
begin
  if to_regprocedure('app.can_module(text,text)') is not null then
    raise exception 'm02_precondition_failed: app.can_module(text,text) already exists - nothing changed' using errcode = 'P0001';
  end if;
  if to_regprocedure('public.has_module_access_level(text,text)') is null or to_regprocedure('app.is_active()') is null
     or to_regprocedure('app.is_admin()') is null or to_regprocedure('app.has_min_role(public.user_role)') is null then
    raise exception 'm02_precondition_failed: required helper functions are missing - nothing changed' using errcode = 'P0001';
  end if;
end;
$m02_pre$;

create function app.can_module(p_module text, p_level text)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
  select coalesce(
    p_level in ('view', 'edit', 'admin')
    and exists (select 1 from public.staff_module_catalog c where c.module_key = p_module and c.is_active)
    and app.is_active()
    and (
      app.is_admin()
      or (app.has_min_role('editor'::public.user_role)
          and coalesce((select pr.access_control_enabled from public.profiles pr where pr.id = auth.uid()), false))
    )
    and public.has_module_access_level(p_module, p_level),
    false);
$function$;

comment on function app.can_module(text, text) is
  'RBAC capability: active staff, valid catalog module + level, explicit grant, and admin role or Custom-access editor. Fail closed.';

revoke all on function app.can_module(text, text) from public, anon, service_role;
grant execute on function app.can_module(text, text) to authenticated;

do $m02_post$
begin
  if not has_function_privilege('authenticated', 'app.can_module(text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'app.can_module(text,text)', 'EXECUTE')
     or not (select prosecdef and pg_get_userbyid(proowner) = 'postgres' and provolatile = 's'
             from pg_proc where oid = to_regprocedure('app.can_module(text,text)')) then
    raise exception 'm02_postcondition_failed: app.can_module is not as intended' using errcode = 'P0001';
  end if;
end;
$m02_post$;
