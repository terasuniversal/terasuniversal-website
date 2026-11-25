-- Bucketed RBAC fingerprint: one row per table (policies, RLS flag, table ACL, columns, triggers, FKs) and per function name.
with f(k,n,h) as (with pol as (
  select 'pol' k, schemaname||'.'||tablename||'.'||policyname n,
         md5(coalesce(cmd,'')||'|'||array_to_string(roles,',')||'|'||coalesce(qual,'')||'|'||coalesce(with_check,'')||'|'||permissive) h
  from pg_policies where schemaname in ('public','app','storage') and schemaname<>'storage'),
fn as (
  select 'fn' k, n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' n,
         md5(replace(p.prosrc, chr(13), '')||'|'||p.prosecdef||'|'||coalesce(array_to_string(p.proconfig,','),'')||'|'||pg_get_userbyid(p.proowner)||'|'||
             coalesce((select string_agg(x, ',' order by x) from unnest(coalesce(p.proacl, acldefault('f', p.proowner))::text[]) x where x !~ '^(supabase_admin|postgres)='),'NULL')) h
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app') and p.prokind in ('f','p')),
tb as (
  select 'tbl' k, n.nspname||'.'||c.relname n,
         md5(c.relrowsecurity::text||'|'||coalesce((select string_agg(x, ',' order by x) from unnest(c.relacl::text[]) x where x ~ '^(anon|authenticated|service_role)='),'')) h
  from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','app') and c.relkind in ('r','v','p')),
col as (
  select 'col' k, table_schema||'.'||table_name n, md5(string_agg(column_name||':'||data_type||':'||coalesce(column_default,''), ',' order by column_name)) h
  from information_schema.columns where table_schema in ('public','app') group by 1,2),
trg as (
  select 'trg' k, c.relname||'.'||t.tgname n, md5(pg_get_triggerdef(t.oid)) h
  from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname='public'),
fk as (
  select 'fk' k, conrelid::regclass::text||'.'||conname n, md5(pg_get_constraintdef(oid)) h from pg_constraint where contype='f' and connamespace='public'::regnamespace)
select k, n, h from (select * from pol union all select * from fn union all select * from tb union all select * from col union all select * from trg union all select * from fk) a order by 1,2),
b as (select case when k='fn' then 'fn:'||split_part(n,'(',1)
                  when k='pol' then 't:'||split_part(n,'.',1)||'.'||split_part(n,'.',2)
                  when k in ('tbl','col') then 't:'||n
                  when k='trg' then 't:public.'||split_part(n,'.',1)
                  else 't:'||case when split_part(n,'.',1) like '%.%' then n else 'public.'||split_part(n,'.',1) end end bk,
             k||'/'||n||'='||h e from f)
select bk, left(md5(string_agg(e, ';' order by e collate "C")),10) from b group by bk order by bk collate "C";
