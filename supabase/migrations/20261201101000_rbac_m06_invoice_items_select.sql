-- RBAC M-06 (M1): invoice line items readable only by staff who may read invoices.
-- Before: invoice_items_select = TO public USING app.has_min_role('editor') - every active editor/admin, including Sales
-- and Management staff without the invoices module, could read every invoice line through PostgREST.
-- After: the same rule as invoices_select (editor floor AND invoices module at View or above), TO authenticated.
-- Narrowing only. Writers are SECURITY DEFINER RPCs owned by postgres (no INSERT/UPDATE/DELETE policy is involved).
-- Approval: OWNER-CRM-RBAC-DEV-20261124 (local development; not applied anywhere).

set local lock_timeout = '5s';

do $m06_pre$
declare r record;
begin
  for r in
    select * from (values
      ($q$invoice_items$q$, $q$invoice_items_select$q$, $q$SELECT$q$, $q$public$q$, $q$app.has_min_role('editor'::user_role)$q$, null)
    ) as t(tbl, pol, cmd, roles, qual, chk)
  loop
    if not exists (select 1 from pg_policies p
                   where p.schemaname = 'public' and p.tablename = r.tbl and p.policyname = r.pol and p.cmd = r.cmd
                     and array_to_string(p.roles, ',') = r.roles and p.permissive = 'PERMISSIVE'
                     and p.qual is not distinct from r.qual and p.with_check is not distinct from r.chk) then
      raise exception 'm06_precondition_failed: policy %.% is not the reviewed pre-state - nothing changed', r.tbl, r.pol using errcode = 'P0001';
    end if;
  end loop;
end;
$m06_pre$;

drop policy if exists invoice_items_select on public.invoice_items;
create policy invoice_items_select on public.invoice_items as permissive for select to authenticated
  using ((app.has_min_role('editor'::public.user_role) AND ( SELECT app.has_any_module_access(ARRAY['invoices'::text], 'view'::text) AS has_any_module_access)));

do $m06_post$
declare r record;
begin
  for r in
    select * from (values
      ($q$invoice_items$q$, $q$invoice_items_select$q$, $q$SELECT$q$, $q$authenticated$q$, $q$has_any_module_access$q$)
    ) as t(tbl, pol, cmd, roles, token)
  loop
    if not exists (select 1 from pg_policies p
                   where p.schemaname = 'public' and p.tablename = r.tbl and p.policyname = r.pol and p.cmd = r.cmd
                     and array_to_string(p.roles, ',') = r.roles
                     and position(r.token in coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')) > 0) then
      raise exception 'm06_postcondition_failed: policy %.% is not as intended', r.tbl, r.pol using errcode = 'P0001';
    end if;
  end loop;
end;
$m06_post$;
