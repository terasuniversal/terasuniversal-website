-- Isolation contract for the DRAFT quotation atomic RPCs. DISPOSABLE DATABASE ONLY (inserts an auth.users fixture).
-- Every RPC must refuse to run outside READ COMMITTED (PostgREST's default) before it reads or writes anything.
-- Run after the M4 draft as role postgres: psql -U postgres -v ON_ERROR_STOP=1 -q -f quotation_atomic_rpcs_isolation_test.sql
begin isolation level repeatable read;

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at)
values ('aaaaaaaa-0000-0000-0000-0000000000f1', 'authenticated', 'authenticated', 'qa-iso@local.test', 'x', now()) on conflict (id) do nothing;
insert into public.profiles (id, email, full_name, role, is_active)
values ('aaaaaaaa-0000-0000-0000-0000000000f1', 'qa-iso@local.test', 'QA Iso', 'super_admin', true) on conflict (id) do update set role = 'super_admin', is_active = true;
select set_config('request.jwt.claims', json_build_object('sub', 'aaaaaaaa-0000-0000-0000-0000000000f1', 'role', 'authenticated')::text, true);

create function pg_temp.qa_err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'NO_ERROR';
exception when others then
  return sqlstate || '|' || sqlerrm;
end;
$$;

do $$
declare
  v_calls text[] := array[
    'select public.create_quotation_with_items(gen_random_uuid(), ''{}''::jsonb, ''[]''::jsonb, gen_random_uuid())',
    'select public.replace_quotation_draft(gen_random_uuid(), ''{}''::jsonb, ''[]''::jsonb, now())',
    'select public.create_quotation_revision(gen_random_uuid(), gen_random_uuid())',
    'select public.mark_quotation_sent(gen_random_uuid())'];
  v_call text;
begin
  perform 1 from pg_settings where name = 'transaction_isolation' and setting = 'repeatable read';
  if not found then raise exception 'assertion_failed: test must run at REPEATABLE READ'; end if;
  foreach v_call in array v_calls loop
    if pg_temp.qa_err(v_call) <> 'P0001|unsupported_isolation_level' then
      raise exception 'assertion_failed: % must refuse REPEATABLE READ, got %', v_call, pg_temp.qa_err(v_call);
    end if;
  end loop;
end $$;

rollback;
select 'quotation_atomic_rpcs_isolation_test: PASS' as result;
