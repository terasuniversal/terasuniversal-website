-- C7A design contract — execute only in an approved non-Production database
-- after the migration draft has been applied to that database for testing.

DO $$
declare
  fn oid;
  fn_def text;
  col_names text[];
  grants_ok boolean;
begin
  select p.oid, pg_get_functiondef(p.oid)
    into fn, fn_def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'verify_and_log'
    and pg_get_function_identity_arguments(p.oid) = 'p_query text, p_method text, p_ip text, p_ua text';

  if fn is null then raise exception 'C7A function is missing'; end if;
  if fn_def not like '%SECURITY DEFINER%' then raise exception 'SECURITY DEFINER was not preserved'; end if;
  if fn_def not like '%search_path = public%' then raise exception 'fixed search_path was not preserved'; end if;
  if fn_def like '%course_schedules%' or fn_def like '%training_schedules%' then raise exception 'mutable schedule inference detected'; end if;
  if fn_def not like '%certificate_issuance_snapshots%' then raise exception 'snapshot source missing'; end if;
  if fn_def not like '%training_start_date%' or fn_def not like '%training_end_date%' then raise exception 'training date source missing'; end if;
  if fn_def not like '%certificate_verifications%' then raise exception 'verification logging missing'; end if;

  select array_agg(a.attname order by a.attnum)
    into col_names
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_attribute a on a.attrelid = p.oid
  where n.nspname = 'public'
    and p.proname = 'verify_and_log'
    and pg_get_function_identity_arguments(p.oid) = 'p_query text, p_method text, p_ip text, p_ua text'
    and a.attnum > 0 and not a.attisdropped;

  if not (col_names @> array['training_start_date', 'training_end_date']) then
    raise exception 'public training date return columns missing';
  end if;

  select bool_and(has_function_privilege(grantee, fn, 'EXECUTE'))
    into grants_ok
  from (values ('anon'), ('authenticated'), ('service_role')) as g(grantee);
  if not coalesce(grants_ok, false) then raise exception 'expected execute grants missing'; end if;

  -- Case matrix to be exercised with synthetic rows in an approved staging DB:
  -- modern snapshot dates => snapshot dates;
  -- snapshot NULL + certificate dates => certificate dates;
  -- legacy certificate dates => certificate dates;
  -- no dates => NULL/NULL;
  -- start-only/end-only => preserve only the available endpoint;
  -- revoked, deleted, unknown => existing status/not-found semantics;
  -- all cases must create the existing verification log row.
end;
$$;
