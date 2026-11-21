-- Sales lead contact corrections: update RPC (3 of 4). Applied to Custom Staging only (20261108130302).
--
-- Why: sales_lead_metadata is admin-update-only and the source tables must stay
-- immutable, so a correction can only be written by a SECURITY DEFINER function that
-- performs its own authorization. Table DML stays revoked from authenticated.
--
-- Authorization (first statement, independent of the application): a valid
-- authenticated subject AND minimum editor role AND sales_leads module level "edit".
-- Both role and module level are required because an account with
-- access_control_enabled can pass the module check without holding the editor role.
--
-- Concurrency: the (always existing) sales_lead_metadata row is locked FOR UPDATE, which
-- serialises corrections per lead and removes the first-insert race on the overlay.
-- p_expected_version is NULL for the first correction (no overlay row yet) and must equal
-- the stored version afterwards; otherwise 'stale_update' is raised.
--
-- Privacy: error codes carry no values and the timeline row stores field NAMES only.
-- Timestamps and actor columns come from table defaults and triggers (now(), auth.uid()),
-- never from the caller.
--
-- EXECUTE privileges: authenticated is the intended application caller and is granted explicitly.
-- anon and PUBLIC are denied EXECUTE. service_role ALSO holds EXECUTE because Supabase default
-- privileges on functions created by postgres in schema public grant it (observed on Custom
-- Staging; the sibling RPCs create_internal_sales_lead and mark_lead_test carry the same ACL).
-- An EXECUTE grant alone authorizes nothing: the function body rejects every caller that lacks
-- an authenticated user identity, the editor role and sales_leads edit access. The service_role
-- denial was observed without an authenticated user identity; other privileged execution
-- contexts were not tested, so no claim is made about them.
-- Rollback: forward repair only (revoke EXECUTE from authenticated, and from service_role if ever required).

create or replace function public.update_sales_lead_contact(
  p_lead_metadata_id uuid,
  p_expected_version integer,
  p_contact_name text,
  p_company text,
  p_email text,
  p_phone text
) returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_source text;
  v_name text := nullif(btrim(coalesce(p_contact_name, '')), '');
  v_company text := nullif(btrim(coalesce(p_company, '')), '');
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_cur_name text;
  v_cur_company text;
  v_cur_email text;
  v_cur_phone text;
  v_ovr public.sales_lead_contact_overrides%rowtype;
  v_has_ovr boolean;
  v_fields text[] := array[]::text[];
  v_version integer;
begin
  if v_actor is null
     or not app.has_min_role('editor'::public.user_role)
     or not public.has_module_access_level('sales_leads', 'edit') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_lead_metadata_id is null or v_name is null then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;
  if char_length(v_name) > 120
     or char_length(coalesce(v_company, '')) > 160
     or char_length(coalesce(v_email, '')) > 254
     or char_length(coalesce(v_phone, '')) > 40 then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;
  if v_email is null and v_phone is null then
    raise exception 'contact_method_required' using errcode = 'P0001';
  end if;
  if v_email is not null and v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception 'invalid_email' using errcode = 'P0001';
  end if;

  select lead_source into v_source
  from public.sales_lead_metadata
  where id = p_lead_metadata_id
  for update;
  if not found then
    raise exception 'lead_not_found' using errcode = 'P0001';
  end if;
  if v_source not in ('enquiry', 'proposal_request', 'internal') then
    raise exception 'source_not_supported' using errcode = 'P0001';
  end if;

  select * into v_ovr
  from public.sales_lead_contact_overrides
  where lead_metadata_id = p_lead_metadata_id;
  v_has_ovr := found;
  if v_has_ovr then
    if p_expected_version is distinct from v_ovr.version then
      raise exception 'stale_update' using errcode = 'P0001';
    end if;
  elsif p_expected_version is not null then
    raise exception 'stale_update' using errcode = 'P0001';
  end if;

  -- Effective current values (the view runs with the function owner's rights here).
  select contact_name, company, email, phone
    into v_cur_name, v_cur_company, v_cur_email, v_cur_phone
  from public.v_sales_lead_inbox
  where lead_metadata_id = p_lead_metadata_id;

  -- Normalise stored values like the input so that a casing or whitespace-only
  -- difference in an untouched field is not reported as a change.
  v_cur_name := nullif(btrim(coalesce(v_cur_name, '')), '');
  v_cur_company := nullif(btrim(coalesce(v_cur_company, '')), '');
  v_cur_email := nullif(lower(btrim(coalesce(v_cur_email, ''))), '');
  v_cur_phone := nullif(btrim(coalesce(v_cur_phone, '')), '');

  if v_name is distinct from v_cur_name then v_fields := v_fields || 'contact_name'; end if;
  if v_company is distinct from v_cur_company then v_fields := v_fields || 'company'; end if;
  if v_email is distinct from v_cur_email then v_fields := v_fields || 'email'; end if;
  if v_phone is distinct from v_cur_phone then v_fields := v_fields || 'phone'; end if;
  if cardinality(v_fields) = 0 then
    raise exception 'no_changes' using errcode = 'P0001';
  end if;

  if v_has_ovr then
    update public.sales_lead_contact_overrides
       set contact_name = v_name,
           company = v_company,
           email = v_email,
           phone = v_phone,
           version = version + 1
     where lead_metadata_id = p_lead_metadata_id
    returning version into v_version;
  else
    insert into public.sales_lead_contact_overrides (lead_metadata_id, contact_name, company, email, phone)
    values (p_lead_metadata_id, v_name, v_company, v_email, v_phone)
    returning version into v_version;
  end if;

  insert into public.sales_activity (lead_metadata_id, type, note, actor_id, metadata)
  values (
    p_lead_metadata_id,
    'contact_details_updated',
    'Contact details corrected',
    v_actor,
    jsonb_build_object('fields', to_jsonb(v_fields), 'version', v_version)
  );

  return v_version;
end;
$$;

revoke all on function public.update_sales_lead_contact(uuid, integer, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.update_sales_lead_contact(uuid, integer, text, text, text, text)
  to authenticated;

do $$
declare
  v_fn constant regprocedure :=
    'public.update_sales_lead_contact(uuid,integer,text,text,text,text)'::regprocedure;
begin
  if has_function_privilege('anon', v_fn, 'execute')
     or not has_function_privilege('authenticated', v_fn, 'execute') then
    raise exception 'lead_contact_postcondition_failed: unexpected EXECUTE grants' using errcode = 'P0001';
  end if;
  if exists (
    select 1
    from pg_proc p, lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid = v_fn and a.grantee = 0
  ) then
    raise exception 'lead_contact_postcondition_failed: PUBLIC holds EXECUTE' using errcode = 'P0001';
  end if;
end $$;
