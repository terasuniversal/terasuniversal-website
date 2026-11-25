-- RBAC M-03 (M5): newly created staff profiles start with Custom Module Access and no grants (fail closed).
-- Before: profiles.access_control_enabled DEFAULT false. app.handle_new_user() inserts every new auth user as role
-- 'editor' without naming that column, so a profile whose provisioning stopped half-way (invite sent, profile/module
-- step failed, or a user created directly in the Supabase dashboard) landed on Role Default Access and received every
-- editor-floor module through the catalog fallback.
-- After: DEFAULT true. Such a profile now has Custom Module Access with zero staff_module_access rows, i.e. no module
-- access until a staff manager explicitly assigns modules (or explicitly chooses Role Default Access).
-- Existing rows are NOT modified (ALTER COLUMN ... SET DEFAULT only affects future inserts); no real staff account
-- changes. handle_new_user() and the public sign-up restrictions are unchanged.
-- Rollback: docs/security/crm-rbac/20261201111000_rbac_m03_fail_closed_profile_default.rollback.sql
-- Approval: OWNER-CRM-RBAC-DEV-20261124 (local development; not applied anywhere).

set local lock_timeout = '5s';

do $m03_pre$
begin
  if (select column_default from information_schema.columns
      where table_schema = 'public' and table_name = 'profiles' and column_name = 'access_control_enabled') is distinct from 'false' then
    raise exception 'm03_precondition_failed: profiles.access_control_enabled default is not the reviewed pre-state (false) - nothing changed'
      using errcode = 'P0001';
  end if;
  if position('access_control_enabled' in (select prosrc from pg_proc where oid = to_regprocedure('app.handle_new_user()'))) > 0 then
    raise exception 'm03_precondition_failed: app.handle_new_user() now sets access_control_enabled itself - review needed'
      using errcode = 'P0001';
  end if;
end;
$m03_pre$;

alter table public.profiles alter column access_control_enabled set default true;

do $m03_post$
begin
  if (select column_default from information_schema.columns
      where table_schema = 'public' and table_name = 'profiles' and column_name = 'access_control_enabled') is distinct from 'true' then
    raise exception 'm03_postcondition_failed: default is not true' using errcode = 'P0001';
  end if;
end;
$m03_post$;
