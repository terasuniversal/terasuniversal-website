-- ROLLBACK for 01_identity_audit_schema.sql (local only). DESTRUCTIVE: drops the evidence schema.
-- It refuses to run when ANY evidence exists (requests, ledger rows or anchors). Dropping evidence in
-- Production needs explicit owner sign-off and a verified offline export first (CLAUDE.md section 11 rule 5).
do $$
begin
  if exists (select 1 from identity_audit.corrections) or exists (select 1 from identity_audit.requests)
     or exists (select 1 from identity_audit.anchors) then
    raise exception 'rollback refused: identity_audit holds evidence; export it and obtain owner sign-off first';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'identity_audit' and p.proname in ('authorized', 'record', 'seal')) then
    raise exception 'rollback refused: helper functions still installed; roll back 02 and 03 first';
  end if;
end $$;
drop schema identity_audit cascade;
