-- P3.2a profile self-update security assertions.
--
-- Run with an existing non-admin Staging profile id:
--   psql ... -v actor_id=<staging-editor-uuid> -f this-file
--
-- The entire test is transactional and must end with ROLLBACK. No Auth or
-- business fixture is created.

\if :{?actor_id}
\else
  \quit 3
\endif

begin;

select plan(12);
select set_config('request.jwt.claim.sub', :'actor_id', true);

create temporary table qa_profile_snapshot as
select id, role, is_active, access_control_enabled, must_change_password,
       department, last_login_at
from public.profiles
where id = :'actor_id'::uuid;

select ok((select count(*) = 1 from qa_profile_snapshot),
  'actor_id resolves to one existing profile');
select ok((select role::text from qa_profile_snapshot) in ('editor', 'trainer'),
  'actor_id is a normal non-admin staff profile');

set local role authenticated;

select throws_ok(format('update public.profiles set role = ''admin'' where id = %L', :'actor_id'),
  '42501', null, 'normal staff cannot self-promote to admin');
select throws_ok(format('update public.profiles set role = ''super_admin'' where id = %L', :'actor_id'),
  '42501', null, 'normal staff cannot self-promote to super_admin');
select throws_ok(format('update public.profiles set access_control_enabled = false where id = %L', :'actor_id'),
  '42501', null, 'normal staff cannot change access-control mode');
select throws_ok(format('update public.profiles set is_active = true where id = %L', :'actor_id'),
  '42501', null, 'normal staff cannot change account activation');
select throws_ok(format('update public.profiles set must_change_password = false where id = %L', :'actor_id'),
  '42501', null, 'normal staff cannot clear password-change enforcement');

select lives_ok(format('update public.profiles set last_login_at = now() where id = %L', :'actor_id'),
  'approved last_login_at self-update remains available');

select ok(has_column_privilege('authenticated', 'public.profiles', 'last_login_at', 'UPDATE'),
  'authenticated retains only the approved last_login_at update column');
select ok(not has_column_privilege('authenticated', 'public.profiles', 'role', 'UPDATE'),
  'authenticated has no role update column privilege');
select ok(not has_column_privilege('authenticated', 'public.profiles', 'access_control_enabled', 'UPDATE'),
  'authenticated has no access-control update column privilege');

reset role;

select is((select role from public.profiles where id = :'actor_id'::uuid),
  (select role from qa_profile_snapshot), 'protected role remains unchanged');

rollback;
