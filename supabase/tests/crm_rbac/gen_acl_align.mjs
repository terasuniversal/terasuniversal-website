// Emits SQL that sets every listed function's EXECUTE grantees to the Production snapshot; unlisted non-extension
// functions in public/app get no client grantees. Optional argv[2] = regex of function names to leave untouched.
import { readFileSync } from "node:fs";
const skip = process.argv[2] ? new RegExp(process.argv[2]) : null;
const rows = readFileSync(new URL("./prod_function_acl_20261124.txt", import.meta.url), "utf8").split("\n").filter((l) => l && !l.startsWith("#"));
const want = new Map(rows.map((l) => { const i = l.lastIndexOf("|"); return [l.slice(0, i), l.slice(i + 1)]; }));
const lit = (s) => "'" + s.replace(/'/g, "''") + "'";
console.log(`do $$ declare r record; g text; want jsonb := ${lit(JSON.stringify(Object.fromEntries(want)))}::jsonb; skip text := ${skip ? lit(skip.source) : "null"}; begin
for r in select p.oid, n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' sig, p.proname
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','app') and p.prokind='f'
    and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e') loop
  continue when skip is not null and r.proname ~ skip;
  -- NULL on Production = PostgreSQL default (PUBLIC EXECUTE); reproduce it with an explicit PUBLIC grant.
  if want->>r.sig = 'NULL' then execute format('grant execute on function %s to public', r.oid::regprocedure); continue; end if;
  execute format('revoke execute on function %s from public, anon, authenticated, service_role', r.oid::regprocedure);
  g := coalesce(want->>r.sig, '-');
  if g <> '-' then execute format('grant execute on function %s to %s', r.oid::regprocedure, replace(g, ' ', ', ')); end if;
end loop; end $$;`);
