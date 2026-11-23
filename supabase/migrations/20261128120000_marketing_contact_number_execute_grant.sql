-- MC-1 (DRAFT, NOT APPLIED ANYWHERE): let staff create marketing contacts again.
--
-- Finding (read-only, Staging eokiaehnvzbggmacifcf and Production iagzkrzeuawaxvacqprk, 2026-11-23):
-- public.marketing_contacts.contact_number defaults to app.next_marketing_contact_number() (SECURITY DEFINER, owner
-- postgres, search_path=app). Its ACL is {postgres=X/postgres}: authenticated has no EXECUTE, so every direct INSERT by a
-- logged-in user (createContact in app/admin/(protected)/marketing/contacts/actions.ts) fails with
-- "permission denied for function next_marketing_contact_number", even for super_admin. The function was created by
-- create_marketing_contacts_v1, which granted the TABLE privileges explicitly but never the function EXECUTE.
-- The sibling app.next_campaign_number() had the same gap and was fixed by granting EXECUTE to authenticated.
--
-- Change: exactly one privilege, matching next_campaign_number / next_quotation_number:
--   GRANT EXECUTE ON FUNCTION app.next_marketing_contact_number() TO authenticated.
-- Not changed: RLS (INSERT still needs editor + marketing_contacts:edit), table grants, anon (no USAGE on schema app),
-- the function body, the sequence, every other next_* function.
-- Fail-closed pre/postconditions; one DO block; idempotent re-run fails closed (precondition).
-- Rollback: revoke execute on function app.next_marketing_contact_number() from authenticated;

do $mc1$
declare
  v_fn regprocedure := to_regprocedure('app.next_marketing_contact_number()');
begin
  perform set_config('lock_timeout', '5s', true);

  if v_fn is null
     or (select md5(prosrc) from pg_proc where oid = v_fn) <> 'e510ba76350107132dfa688c3b793924'
     or not (select prosecdef from pg_proc where oid = v_fn)
     or (select pg_get_userbyid(proowner) from pg_proc where oid = v_fn) <> 'postgres'
     or (select proconfig::text from pg_proc where oid = v_fn) is distinct from '{search_path=app}'
     or (select proacl::text from pg_proc where oid = v_fn) is distinct from '{postgres=X/postgres}' then
    raise exception 'mc1_precondition_failed: app.next_marketing_contact_number() is not the reviewed pre-state - nothing changed'
      using errcode = 'P0001';
  end if;

  grant execute on function app.next_marketing_contact_number() to authenticated;

  if (select proacl::text from pg_proc where oid = v_fn) is distinct from '{postgres=X/postgres,authenticated=X/postgres}'
     or has_function_privilege('anon', v_fn, 'EXECUTE')
     or has_schema_privilege('anon', 'app', 'USAGE') then
    raise exception 'mc1_postcondition_failed: unexpected ACL after grant' using errcode = 'P0001';
  end if;
end;
$mc1$;
