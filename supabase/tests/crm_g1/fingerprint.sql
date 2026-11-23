-- name(args) | md5(prosrc) | acl | owner | secdef | config, for every record_manual_payment* function, then the index list.
select p.oid::regprocedure::text, md5(p.prosrc), coalesce(p.proacl::text, ''), pg_get_userbyid(p.proowner), p.prosecdef, coalesce(p.proconfig::text, '')
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'record_manual_payment%'
union all
select 'index ' || indexname, md5(indexdef), '', '', false, '' from pg_indexes where schemaname = 'public' and tablename = 'invoice_payments'
order by 1;
