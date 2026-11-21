-- M-S2: restrict direct sales_activity writes by module, role floor, record context and actor.
--
-- Why: sales_activity_insert only required app.has_min_role('editor'), so any active editor could write any activity
-- type, on any lead, under any actor_id, even with no access to the module the activity belongs to. That let a View-only
-- user forge timeline history (for example "invoice_paid" or another person's note). sales_lead_attributions INSERT and
-- UPDATE had the same role-only check. The application already enforces module "edit" access in its Server Actions
-- (PR #227); this migration makes RLS enforce the same model so a direct PostgREST call cannot bypass it.
--
-- Scope: one SECURITY DEFINER helper (app.can_insert_sales_activity), the sales_activity INSERT policy and the
-- sales_lead_attributions INSERT/UPDATE policies. No table, column, CHECK constraint, SELECT policy, trigger, table
-- privilege or data change. Only sales_activity columns verified on Custom Staging are used: type, lead_metadata_id,
-- opportunity_id, quotation_id, actor_id.
--
-- What is NOT affected: the SECURITY DEFINER RPCs that write sales_activity (convert_lead_to_opportunity,
-- accept_quotation, invoice/payment/receipt RPCs, update_sales_lead_contact, ...) are owned by postgres, which owns the
-- table and is not subject to its RLS (FORCE ROW LEVEL SECURITY is off), and service_role has BYPASSRLS. Their activity
-- types are therefore deliberately absent from the allow-list below: a direct client INSERT of them is rejected.
--
-- Deployment order: PR #227 (module edit enforcement in the Server Actions) must be live first. Without it the old
-- actions still let View users mutate records and would then fail to write their timeline entry.
--
-- Rollback: re-create the previous policies and drop the helper:
--   drop policy if exists sales_activity_insert on public.sales_activity;
--   create policy sales_activity_insert on public.sales_activity for insert to authenticated
--     with check (app.has_min_role('editor'::public.user_role));
--   drop policy if exists sales_lead_attributions_insert on public.sales_lead_attributions;
--   create policy sales_lead_attributions_insert on public.sales_lead_attributions for insert to authenticated
--     with check (app.has_min_role('editor'::public.user_role));
--   drop policy if exists sales_lead_attributions_update on public.sales_lead_attributions;
--   create policy sales_lead_attributions_update on public.sales_lead_attributions for update to authenticated
--     using (app.has_min_role('editor'::public.user_role)) with check (app.has_min_role('editor'::public.user_role));
--   drop function if exists app.can_insert_sales_activity(text, uuid, uuid, uuid);

do $$
begin
  if (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'sales_activity'
      and column_name in ('type', 'lead_metadata_id', 'opportunity_id', 'quotation_id', 'actor_id')
  ) <> 5 then
    raise exception 'ms2_precondition_failed: public.sales_activity is missing a required column' using errcode = 'P0001';
  end if;
  if to_regprocedure('public.has_module_access_level(text,text)') is null
     or to_regprocedure('app.has_min_role(public.user_role)') is null
     or to_regprocedure('app.is_admin()') is null then
    raise exception 'ms2_precondition_failed: an authorization helper is missing' using errcode = 'P0001';
  end if;
end;
$$;

-- Returns true only when the CURRENT caller may write this activity row directly. Every branch checks the role floor
-- and module "edit" access first and returns false before touching any record, so a caller without the right access
-- learns nothing about which opportunities or quotations belong to which lead. Callers who pass those checks already
-- hold SELECT on the same tables through the existing role-based policies, so the record checks disclose nothing new.
create or replace function app.can_insert_sales_activity(
  p_type text,
  p_lead_metadata_id uuid,
  p_opportunity_id uuid,
  p_quotation_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_type is null or p_lead_metadata_id is null then
    return false;
  end if;

  -- context: lead
  if p_type in ('note_added', 'status_changed', 'won', 'lost', 'assigned', 'followup_scheduled', 'priority_changed', 'qualification_changed', 'temperature_changed') and p_opportunity_id is null and p_quotation_id is null then
    if not public.has_module_access_level('sales_leads', 'edit') then
      return false;
    end if;
    if p_type = 'note_added' then
      return app.has_min_role('editor'::public.user_role);
    end if;
    return app.is_admin();
  end if;

  -- context: opportunity
  if p_type in ('note_added', 'status_changed', 'assigned', 'company_linked', 'company_created') and p_opportunity_id is not null and p_quotation_id is null then
    if not public.has_module_access_level('sales_opportunities', 'edit') then
      return false;
    end if;
    if p_type = 'note_added' then
      if not app.has_min_role('editor'::public.user_role) then
        return false;
      end if;
    elsif not app.is_admin() then
      return false;
    end if;
    if p_type = 'company_created' and not public.has_module_access_level('companies', 'edit') then
      return false;
    end if;
    return exists (
      select 1
      from public.sales_opportunities o
      where o.id = p_opportunity_id
        and o.lead_metadata_id = p_lead_metadata_id
    );
  end if;

  -- context: quotation
  if p_type in ('quotation_created', 'quotation_sent', 'quotation_revised') and p_opportunity_id is not null and p_quotation_id is not null then
    if not public.has_module_access_level('sales_quotations', 'edit') then
      return false;
    end if;
    if not app.is_admin() then
      return false;
    end if;
    return exists (
      select 1
      from public.sales_quotations q
      join public.sales_opportunities o on o.id = q.opportunity_id
      where q.id = p_quotation_id
        and q.opportunity_id = p_opportunity_id
        and o.lead_metadata_id = p_lead_metadata_id
    );
  end if;

  -- context: task
  if p_type in ('task_created', 'task_completed', 'task_reopened', 'task_cancelled') then
    if not public.has_module_access_level('sales_tasks', 'edit') then
      return false;
    end if;
    if not app.has_min_role('editor'::public.user_role) then
      return false;
    end if;
    -- A task may reference a lead, an opportunity and/or a quotation; whichever is given must belong to the lead.
    if p_quotation_id is not null then
      return exists (
        select 1
        from public.sales_quotations q
        join public.sales_opportunities o on o.id = q.opportunity_id
        where q.id = p_quotation_id
          and (p_opportunity_id is null or q.opportunity_id = p_opportunity_id)
          and o.lead_metadata_id = p_lead_metadata_id
      );
    end if;
    if p_opportunity_id is not null then
      return exists (
        select 1
        from public.sales_opportunities o
        where o.id = p_opportunity_id
          and o.lead_metadata_id = p_lead_metadata_id
      );
    end if;
    return true;
  end if;

  -- context: training_handoff
  if p_type in ('training_handoff_created') and p_opportunity_id is not null then
    if not public.has_module_access_level('schedules', 'edit') then
      return false;
    end if;
    if not app.is_admin() then
      return false;
    end if;
    if p_quotation_id is not null then
      return exists (
        select 1
        from public.sales_quotations q
        join public.sales_opportunities o on o.id = q.opportunity_id
        where q.id = p_quotation_id
          and q.opportunity_id = p_opportunity_id
          and o.lead_metadata_id = p_lead_metadata_id
      );
    end if;
    return exists (
      select 1
      from public.sales_opportunities o
      where o.id = p_opportunity_id
        and o.lead_metadata_id = p_lead_metadata_id
    );
  end if;

  -- default deny: RPC-only types, unknown types and unsupported contexts.
  return false;
end;
$$;

alter function app.can_insert_sales_activity(text, uuid, uuid, uuid) owner to postgres;
-- The policy is evaluated as the calling role, so authenticated needs EXECUTE. Nobody else does: anon has no policy
-- that reaches it, and service_role and postgres bypass RLS. Revoke explicitly because this project carries default
-- privileges that could otherwise grant EXECUTE to new functions.
revoke all on function app.can_insert_sales_activity(text, uuid, uuid, uuid) from public, anon, service_role;
grant execute on function app.can_insert_sales_activity(text, uuid, uuid, uuid) to authenticated;

drop policy if exists sales_activity_insert on public.sales_activity;
create policy sales_activity_insert on public.sales_activity
  for insert to authenticated
  with check (
    actor_id = (select auth.uid())
    and app.can_insert_sales_activity(type, lead_metadata_id, opportunity_id, quotation_id)
  );

-- Attribution is written only by setLeadAttribution (editor + Leads edit) and by the SECURITY DEFINER
-- create_internal_sales_lead RPC, which bypasses RLS. Upsert needs both policies.
drop policy if exists sales_lead_attributions_insert on public.sales_lead_attributions;
create policy sales_lead_attributions_insert on public.sales_lead_attributions
  for insert to authenticated
  with check (
    app.has_min_role('editor'::public.user_role)
    and public.has_module_access_level('sales_leads', 'edit')
  );

drop policy if exists sales_lead_attributions_update on public.sales_lead_attributions;
create policy sales_lead_attributions_update on public.sales_lead_attributions
  for update to authenticated
  using (
    app.has_min_role('editor'::public.user_role)
    and public.has_module_access_level('sales_leads', 'edit')
  )
  with check (
    app.has_min_role('editor'::public.user_role)
    and public.has_module_access_level('sales_leads', 'edit')
  );

do $$
begin
  if has_function_privilege('anon', 'app.can_insert_sales_activity(text,uuid,uuid,uuid)', 'EXECUTE') then
    raise exception 'ms2_postcondition_failed: anon can execute app.can_insert_sales_activity' using errcode = 'P0001';
  end if;
  if not has_function_privilege('authenticated', 'app.can_insert_sales_activity(text,uuid,uuid,uuid)', 'EXECUTE') then
    raise exception 'ms2_postcondition_failed: authenticated cannot execute app.can_insert_sales_activity' using errcode = 'P0001';
  end if;
end;
$$;
