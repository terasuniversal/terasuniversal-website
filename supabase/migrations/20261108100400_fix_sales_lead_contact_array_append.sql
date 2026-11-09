-- Sales lead contact corrections: fix the changed-field list in update_sales_lead_contact (5, remediation). NOT APPLIED anywhere yet.
--
-- Why: migration 3 appended each changed field with `v_fields := v_fields || 'contact_name'`. PostgreSQL resolves
-- `text[] || unknown-literal` as array || array and tries to read the literal as an array, so every correction
-- that changed a field failed with 22P02 "malformed array literal" (observed on Custom Staging; no row was
-- written). array_append(v_fields, 'x'::text) is explicitly typed and has no such ambiguity.
--
-- Scope: CREATE OR REPLACE of the existing function only. The body is identical to migration 3 except for the
-- four appends. Signature, return type, SECURITY DEFINER, search_path, owner, the authorization guard (valid
-- subject AND editor role AND sales_leads module edit), the optimistic version check, the per-lead lock, the
-- validation and the field-names-only timeline metadata are unchanged. No table, view, policy or data is touched.
--
-- Privileges: CREATE OR REPLACE keeps the owner and the existing ACL. The preflight records the ACL and refuses to
-- run if the function is missing, has another identity, or if anon or PUBLIC hold EXECUTE; the postcondition
-- verifies that the ACL is exactly what it was before and that the effective grants are unchanged. EXECUTE is
-- granted explicitly to authenticated only; service_role holds the Supabase default EXECUTE (accepted by the Owner)
-- and an EXECUTE grant alone authorizes nothing because the body rejects callers without an authenticated user
-- identity, the editor role and sales_leads edit access.
--
-- Idempotent: running it again replaces the function with the same text and leaves the ACL untouched.
-- Rollback: forward repair only.

do $$
declare
  v_fn constant regprocedure := to_regprocedure('public.update_sales_lead_contact(uuid,integer,text,text,text,text)');
  v_acl text;
begin
  if v_fn is null then
    raise exception 'lead_contact_fix_precondition_failed: function is missing' using errcode = 'P0001';
  end if;
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'update_sales_lead_contact') <> 1 then
    raise exception 'lead_contact_fix_precondition_failed: unexpected overload count' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from pg_proc p
    where p.oid = v_fn and p.prosecdef and p.proowner = 'postgres'::regrole
      and 'search_path=pg_catalog, public' = any (p.proconfig)
      and pg_get_function_result(p.oid) = 'integer'
  ) then
    raise exception 'lead_contact_fix_precondition_failed: function identity differs from migration 3' using errcode = 'P0001';
  end if;
  if has_function_privilege('anon', v_fn, 'execute') or not has_function_privilege('authenticated', v_fn, 'execute') then
    raise exception 'lead_contact_fix_precondition_failed: unexpected EXECUTE grants' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from pg_proc p, lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid = v_fn and a.grantee = 0
  ) then
    raise exception 'lead_contact_fix_precondition_failed: PUBLIC holds EXECUTE' using errcode = 'P0001';
  end if;
  select proacl::text into v_acl from pg_proc where oid = v_fn;
  perform set_config('lead_contact.acl_before', coalesce(v_acl, ''), true);
end $$;

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

  if v_name is distinct from v_cur_name then v_fields := array_append(v_fields, 'contact_name'::text); end if;
  if v_company is distinct from v_cur_company then v_fields := array_append(v_fields, 'company'::text); end if;
  if v_email is distinct from v_cur_email then v_fields := array_append(v_fields, 'email'::text); end if;
  if v_phone is distinct from v_cur_phone then v_fields := array_append(v_fields, 'phone'::text); end if;
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

do $$
declare
  v_fn constant regprocedure := 'public.update_sales_lead_contact(uuid,integer,text,text,text,text)'::regprocedure;
  v_before text := nullif(current_setting('lead_contact.acl_before', true), '');
  v_now text;
  v_def text;
begin
  select proacl::text into v_now from pg_proc where oid = v_fn;
  if v_before is not null and v_before is distinct from v_now then
    raise exception 'lead_contact_fix_postcondition_failed: ACL changed' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from pg_proc p
    where p.oid = v_fn and p.prosecdef and p.proowner = 'postgres'::regrole
      and 'search_path=pg_catalog, public' = any (p.proconfig)
      and pg_get_function_result(p.oid) = 'integer'
  ) then
    raise exception 'lead_contact_fix_postcondition_failed: signature or security settings changed' using errcode = 'P0001';
  end if;
  if has_function_privilege('anon', v_fn, 'execute') or not has_function_privilege('authenticated', v_fn, 'execute') then
    raise exception 'lead_contact_fix_postcondition_failed: unexpected EXECUTE grants' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from pg_proc p, lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid = v_fn and a.grantee = 0
  ) then
    raise exception 'lead_contact_fix_postcondition_failed: PUBLIC holds EXECUTE' using errcode = 'P0001';
  end if;
  v_def := pg_get_functiondef(v_fn);
  if position('v_fields ||' in v_def) > 0
     or (length(v_def) - length(replace(v_def, 'array_append(v_fields', ''))) / length('array_append(v_fields') <> 4 then
    raise exception 'lead_contact_fix_postcondition_failed: changed-field list is not built with array_append' using errcode = 'P0001';
  end if;
end $$;
