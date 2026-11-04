-- ============================================================================
-- DRAFT -- NOT APPLIED -- NOT IN THE ACTIVE MIGRATION CHAIN.
-- P0 quotation integrity, step M4: atomic quotation write RPCs.
--
-- Dependency chain (staging, in order; each step has its own gates):
--   S0 (post invoice_v1_hardening, pre invoice_phase5)
--     -> P1 20260911115407_invoice_phase5_quotation_snapshots
--     -> P2 20260911133000_invoice_phase5_snapshot_column_alignment (rename; once)
--     -> P3 20260912005428_sst_readiness_invoice_corporate (constraints; once)
--     -> M4 this file.
-- M4 reads columns and constraints that only exist after P3 and refuses to run
-- before it. It does not touch invoices, invoice_items or certificates.
--
-- What it adds: one ledger table (public.sales_quotation_requests), seven
-- internal helpers in schema app (not callable by clients) and four SECURITY
-- DEFINER RPCs callable by authenticated admins:
--   create_quotation_with_items(opportunity, header, items, request_id) -> id
--   replace_quotation_draft(quotation, header, items, expected_updated_at)
--   create_quotation_revision(source_quotation, request_id) -> id
--   mark_quotation_sent(quotation)
-- The application is NOT switched to them by this file.
--
-- Conventions mirrored from the live accept_quotation(): owner postgres,
-- SECURITY DEFINER, search_path pg_catalog, public, app, app.is_admin() first
-- (42501 'forbidden'), business errors P0001, lock order opportunity row ->
-- quotation rows. Every write of one RPC call is one transaction, so any error
-- rolls back everything it did, including the audit row and the ledger row.
--
-- Run as ONE transaction as role postgres (for example `psql -1 -v
-- ON_ERROR_STOP=1 -f`). Forward-only: there is no down migration; to stop using
-- the RPCs revoke EXECUTE and revert the application, keep the ledger table.
--
-- OWNER DECISIONS embedded below and marked D4 / D5 / D6 / D8:
--   D4 inputs must have at most 2 decimals (stricter than today's Zod schema);
--   D5 a negative line total is rejected (totals_invalid:negative_line);
--   D6 no extra send validation (a draft with any content can be marked sent);
--   D8 creating a quotation moves any non-resolved opportunity to 'quotation'.
-- ============================================================================

-- 0. Preconditions. Any failure stops the whole migration.
do $$
declare
  v_missing text[];
begin
  if current_user <> 'postgres' then
    raise exception 'm4_precondition_failed: run as role postgres (the revenue guard tests current_user), not %', current_user using errcode = 'P0001';
  end if;

  select array_agg(t) into v_missing
  from unnest(array[
    'public.sales_quotations', 'public.sales_quotation_items', 'public.sales_opportunities',
    'public.sales_activity', 'public.courses', 'public.profiles'
  ]) as t
  where to_regclass(t) is null;
  if v_missing is not null then
    raise exception 'm4_precondition_failed: missing tables %', v_missing using errcode = 'P0001';
  end if;

  if to_regprocedure('app.is_admin()') is null then
    raise exception 'm4_precondition_failed: app.is_admin() is missing' using errcode = 'P0001';
  end if;

  -- P3 (20260912005428) must be applied: SST amount and the four snapshots, and the arithmetic constraint.
  if (
    select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'sales_quotations'
      and column_name in ('sst_amount', 'tax_label_snapshot', 'tax_basis_snapshot', 'sst_registration_number_snapshot', 'sst_effective_date_snapshot')
  ) <> 5 then
    raise exception 'm4_precondition_failed: P3 20260912005428 is not applied (SST columns missing on sales_quotations)' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.sales_quotations'::regclass and conname = 'sales_quotations_total_arithmetic_check'
  ) then
    raise exception 'm4_precondition_failed: P3 20260912005428 is not applied (total arithmetic constraint missing)' using errcode = 'P0001';
  end if;

  -- P1 and P2 are part of the chain even though M4 never writes invoices: the invoice snapshot columns must carry their
  -- final (P2-renamed) names and the old names must be gone, and P3's guard trigger must exist. A database that has P3's
  -- quotation columns but not this invoice shape is in an unexpected state; stop rather than layer M4 on it.
  if (
    select count(*) from information_schema.columns
    where table_schema = 'public' and (
      (table_name = 'invoices' and column_name in ('quotation_number_snapshot', 'training_service_address_snapshot'))
      or (table_name = 'invoice_items' and column_name in ('course_id_snapshot', 'course_name_snapshot', 'hrdf_claim', 'package_includes_snapshot')))
  ) <> 6 or exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and (
      (table_name = 'invoices' and column_name in ('quotation_no', 'training_service_address'))
      or (table_name = 'invoice_items' and column_name = 'course_id'))
  ) then
    raise exception 'm4_precondition_failed: invoice snapshot columns are not in the post-P1/P2 shape' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from pg_trigger where tgrelid = 'public.sales_quotations'::regclass and tgname = 'trg_guard_quotation_sst_snapshot' and not tgisinternal
  ) then
    raise exception 'm4_precondition_failed: P3 20260912005428 guard trigger is missing' using errcode = 'P0001';
  end if;

  -- Commercial snapshot columns the RPCs read and write.
  if (
    select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'sales_quotation_items'
      and column_name in ('course_id', 'course_name_snapshot', 'hrdf_claim', 'package_includes_snapshot', 'line_total')
  ) <> 5 then
    raise exception 'm4_precondition_failed: sales_quotation_items commercial snapshot columns missing' using errcode = 'P0001';
  end if;
  if (
    select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'sales_quotations'
      and column_name in ('customer_company_name', 'customer_contact_name', 'customer_registration_no', 'customer_email', 'customer_phone', 'billing_address', 'training_service_address')
  ) <> 7 then
    raise exception 'm4_precondition_failed: sales_quotations customer snapshot columns missing' using errcode = 'P0001';
  end if;

  -- If a ledger table already exists it must be exactly the one this file defines; create table if not exists would
  -- otherwise accept a drifted definition silently.
  if to_regclass('public.sales_quotation_requests') is not null and (
    select array_agg(column_name || ':' || data_type || ':' || is_nullable order by column_name)
    from information_schema.columns where table_schema = 'public' and table_name = 'sales_quotation_requests'
  ) is distinct from array['created_at:timestamp with time zone:NO', 'created_by:uuid:NO', 'fingerprint:text:NO', 'kind:text:NO', 'quotation_id:uuid:YES', 'request_id:uuid:NO'] then
    raise exception 'm4_precondition_failed: public.sales_quotation_requests exists with an unexpected definition; reconcile before applying' using errcode = 'P0001';
  end if;

  -- A quotation family (same quotation_no) must live under one opportunity; the lock protocol relies on it.
  if exists (select 1 from public.sales_quotations group by quotation_no having count(distinct opportunity_id) > 1) then
    raise exception 'm4_precondition_failed: a quotation family spans more than one opportunity' using errcode = 'P0001';
  end if;

  -- The activity types the RPCs write must be allowed by the live check constraint.
  if exists (
    select 1 from (values ('quotation_created'), ('quotation_sent'), ('quotation_revised')) as v(t)
    where not exists (
      select 1 from pg_constraint c
      where c.conrelid = 'public.sales_activity'::regclass and c.conname = 'sales_activity_type_check'
        and pg_get_constraintdef(c.oid) like '%' || v.t || '%'
    )
  ) then
    raise exception 'm4_precondition_failed: sales_activity_type_check does not allow quotation_created/sent/revised' using errcode = 'P0001';
  end if;
end;
$$;

-- 1. Request ledger: idempotency for create and revise. Written and read only by
-- the SECURITY DEFINER RPCs below. RLS is on with no policy and every client
-- privilege is revoked, so clients can neither read nor forge ledger rows.
create table if not exists public.sales_quotation_requests (
  created_by uuid not null,
  request_id uuid not null,
  kind text not null,
  fingerprint text not null,
  quotation_id uuid references public.sales_quotations(id),
  created_at timestamptz not null default now(),
  constraint sales_quotation_requests_pkey primary key (created_by, request_id),
  constraint sales_quotation_requests_kind_check check (kind in ('create', 'revise')),
  constraint sales_quotation_requests_fingerprint_check check (fingerprint ~ '^[0-9a-f]{64}$')
);
create index if not exists sales_quotation_requests_quotation_id_idx on public.sales_quotation_requests (quotation_id);
alter table public.sales_quotation_requests enable row level security;
revoke all on table public.sales_quotation_requests from public, anon, authenticated;
comment on table public.sales_quotation_requests is
  'Idempotency ledger for create_quotation_with_items and create_quotation_revision. Definer-only; one row per (actor, request id). Rows are small and kept.';

-- 2. Internal helpers (schema app). Not callable by clients.

-- A JSON number or numeric string, at most 2 decimals, inside [p_min, p_max] (p_min excluded when p_min_exclusive).
create or replace function app.quotation_input_numeric(
  p_value jsonb, p_field text, p_min numeric, p_max numeric,
  p_min_exclusive boolean default false, p_default numeric default null
) returns numeric
language plpgsql
set search_path = pg_catalog, public, app
as $$
declare
  v_type text := jsonb_typeof(p_value);
  v_text text;
  v numeric;
begin
  if p_value is null or v_type = 'null' then
    if p_default is not null then return round(p_default, 2); end if;
    raise exception 'invalid_input:%', p_field using errcode = 'P0001';
  end if;
  if v_type = 'number' then
    v := (p_value #>> '{}')::numeric;
  elsif v_type = 'string' then
    v_text := btrim(p_value #>> '{}');
    if v_text !~ '^-?[0-9]+(\.[0-9]+)?$' then
      raise exception 'invalid_input:%', p_field using errcode = 'P0001';
    end if;
    v := v_text::numeric;
  else
    raise exception 'invalid_input:%', p_field using errcode = 'P0001';
  end if;
  -- D4: at most 2 decimals, so no value is silently rounded on its way into numeric(x,2).
  if v <> round(v, 2) then
    raise exception 'invalid_input:%', p_field using errcode = 'P0001';
  end if;
  if v > p_max or v < p_min or (p_min_exclusive and v = p_min) then
    raise exception 'invalid_input:%', p_field using errcode = 'P0001';
  end if;
  return round(v, 2);
end;
$$;

-- A JSON string, trimmed; empty or null becomes NULL unless required; longer than p_max is rejected.
create or replace function app.quotation_input_text(p_value jsonb, p_field text, p_max integer, p_required boolean default false)
returns text
language plpgsql
set search_path = pg_catalog, public, app
as $$
declare
  v_text text;
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then
    if p_required then raise exception 'invalid_input:%', p_field using errcode = 'P0001'; end if;
    return null;
  end if;
  if jsonb_typeof(p_value) <> 'string' then
    raise exception 'invalid_input:%', p_field using errcode = 'P0001';
  end if;
  v_text := regexp_replace(p_value #>> '{}', '^[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$', '', 'g');
  if v_text = '' then
    if p_required then raise exception 'invalid_input:%', p_field using errcode = 'P0001'; end if;
    return null;
  end if;
  if char_length(v_text) > p_max then
    raise exception 'invalid_input:%', p_field using errcode = 'P0001';
  end if;
  return v_text;
end;
$$;

-- Validates and normalises the header object. Output has fixed keys and typed values, so equal inputs give equal jsonb.
create or replace function app.quotation_normalize_header(p_header jsonb)
returns jsonb
language plpgsql
set search_path = pg_catalog, public, app
as $$
declare
  v_applicable boolean;
  v_rate numeric;
  v_email text;
  v_valid_text text;
  v_valid date;
begin
  if p_header is null or jsonb_typeof(p_header) <> 'object' then
    raise exception 'invalid_input:header' using errcode = 'P0001';
  end if;

  if p_header -> 'sst_applicable' is null or jsonb_typeof(p_header -> 'sst_applicable') = 'null' then
    v_applicable := false;
  elsif jsonb_typeof(p_header -> 'sst_applicable') = 'boolean' then
    v_applicable := (p_header ->> 'sst_applicable')::boolean;
  else
    raise exception 'invalid_input:sst_applicable' using errcode = 'P0001';
  end if;
  v_rate := app.quotation_input_numeric(p_header -> 'sst_rate', 'sst_rate', 0, 100, false, 0);

  v_email := app.quotation_input_text(p_header -> 'customer_email', 'customer_email', 320);
  if v_email is not null and v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'invalid_input:customer_email' using errcode = 'P0001';
  end if;

  v_valid_text := app.quotation_input_text(p_header -> 'valid_until', 'valid_until', 10);
  if v_valid_text is not null then
    if v_valid_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'invalid_input:valid_until' using errcode = 'P0001';
    end if;
    begin
      v_valid := v_valid_text::date;
    exception when others then
      raise exception 'invalid_input:valid_until' using errcode = 'P0001';
    end;
  end if;

  return jsonb_build_object(
    'customer_company_name', app.quotation_input_text(p_header -> 'customer_company_name', 'customer_company_name', 200),
    'customer_contact_name', app.quotation_input_text(p_header -> 'customer_contact_name', 'customer_contact_name', 200),
    'customer_registration_no', app.quotation_input_text(p_header -> 'customer_registration_no', 'customer_registration_no', 100),
    'customer_email', v_email,
    'customer_phone', app.quotation_input_text(p_header -> 'customer_phone', 'customer_phone', 60),
    'billing_address', app.quotation_input_text(p_header -> 'billing_address', 'billing_address', 1000),
    'training_service_address', app.quotation_input_text(p_header -> 'training_service_address', 'training_service_address', 1000),
    'valid_until', v_valid,
    'currency', coalesce(app.quotation_input_text(p_header -> 'currency', 'currency', 10), 'MYR'),
    'discount', app.quotation_input_numeric(p_header -> 'discount', 'discount', 0, 9999999999.99, false, 0),
    'sst_applicable', v_applicable,
    -- Same as the application today: the rate is stored as 0 whenever SST is not applied.
    'sst_rate', case when v_applicable then v_rate else round(0::numeric, 2) end,
    'terms', app.quotation_input_text(p_header -> 'terms', 'terms', 3000),
    'notes', app.quotation_input_text(p_header -> 'notes', 'notes', 3000)
  );
end;
$$;

-- Checks one item's course snapshots against its course_commercial_profiles row, mirroring the application
-- (prepareQuotationItems, canonicalizePackageSnapshot, commercialName in lib/sales/course-commercial.ts). It only
-- REJECTS or de-duplicates; it never rewrites a value. Returns the package array with duplicate keys dropped (first wins).
create or replace function app.quotation_check_course_commercial(
  p_course uuid, p_hrdf boolean, p_name text, p_package jsonb, p_prefix text
) returns jsonb
language plpgsql
set search_path = pg_catalog, public, app
as $$
declare
  v_profile public.course_commercial_profiles%rowtype;
  v_hrdf_name text;
  v_expected text;
  v_allowed text[] := '{}';
  v_elem jsonb;
  v_label text;
  v_key text;
  v_acc text;
  v_meals text;
  v_out jsonb := '[]'::jsonb;
  v_seen text[] := '{}';
  v_item jsonb;
  v_trim constant text := '^[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$';
begin
  select * into v_profile from public.course_commercial_profiles p where p.course_id = p_course;
  if not found then
    raise exception 'invalid_input:%course_profile', p_prefix using errcode = 'P0001';
  end if;

  v_hrdf_name := regexp_replace(coalesce(v_profile.hrdf_display_name, ''), v_trim, '', 'g');
  if p_hrdf and not (v_profile.hrdf_claimable and v_hrdf_name <> '') then
    raise exception 'invalid_input:%hrdf_claim', p_prefix using errcode = 'P0001';
  end if;
  v_expected := case when p_hrdf and v_profile.hrdf_claimable and v_hrdf_name <> '' then v_hrdf_name
                     else v_profile.standard_display_name end;
  if p_name is distinct from regexp_replace(v_expected, v_trim, '', 'g') then
    raise exception 'invalid_input:%course_name_snapshot', p_prefix using errcode = 'P0001';
  end if;

  -- Case conversion and the character class are spelled out (translate, explicit ranges) so the slug never depends on the
  -- database locale (for example Turkish I) or on collation ordering of [a-z].
  -- Allowed package keys: the profile's package_includes (strings or {key,label}), plus accommodation / meals when described.
  for v_elem in select e.value from jsonb_array_elements(v_profile.package_includes) as e loop
    if jsonb_typeof(v_elem) = 'string' then
      v_label := regexp_replace(v_elem #>> '{}', v_trim, '', 'g');
      v_key := null;
      -- Non-ASCII labels are skipped: PostgreSQL lower() and JavaScript toLowerCase() can differ there, and skipping can only
      -- REJECT a key the application would accept, never accept one it would reject.
      if v_label <> '' and v_label ~ '^[\x01-\x7f]*$' then
        v_key := coalesce(nullif(left(regexp_replace(regexp_replace(translate(v_label, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '[^abcdefghijklmnopqrstuvwxyz0123456789]+', '_', 'g'), '^_|_$', '', 'g'), 80), ''), 'package_item');
      end if;
    elsif jsonb_typeof(v_elem) = 'object' then
      v_label := case when jsonb_typeof(v_elem -> 'label') = 'string' then regexp_replace(v_elem ->> 'label', v_trim, '', 'g') else '' end;
      v_key := case when jsonb_typeof(v_elem -> 'key') = 'string' then regexp_replace(v_elem ->> 'key', v_trim, '', 'g')
                    else coalesce(nullif(left(regexp_replace(regexp_replace(translate(v_label, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '[^abcdefghijklmnopqrstuvwxyz0123456789]+', '_', 'g'), '^_|_$', '', 'g'), 80), ''), 'package_item') end;
      if v_label = '' or v_key = '' then v_key := null; end if;
      -- A key derived from a non-ASCII label is skipped for the same reason; explicit keys are only trimmed.
      if v_key is not null and jsonb_typeof(v_elem -> 'key') is distinct from 'string' and v_label !~ '^[\x01-\x7f]*$' then v_key := null; end if;
    else
      v_key := null;
    end if;
    if v_key is not null and v_key <> '' then v_allowed := v_allowed || v_key; end if;
  end loop;
  v_acc := regexp_replace(coalesce(v_profile.accommodation_description_default, ''), v_trim, '', 'g');
  v_meals := regexp_replace(coalesce(v_profile.meals_description_default, ''), v_trim, '', 'g');
  if v_acc <> '' then v_allowed := v_allowed || 'accommodation'::text; end if;
  if v_meals <> '' then v_allowed := v_allowed || 'meals'::text; end if;

  for v_item in select e.value from jsonb_array_elements(p_package) as e loop
    if not ((v_item ->> 'key') = any (v_allowed)) then
      raise exception 'invalid_input:%package_includes_snapshot', p_prefix using errcode = 'P0001';
    end if;
    if (v_item ->> 'key') = any (v_seen) then
      continue;
    end if;
    v_seen := v_seen || (v_item ->> 'key');
    v_out := v_out || jsonb_build_array(v_item);
  end loop;
  return v_out;
end;
$$;

-- Validates and normalises the item array. sort_order is the array position. Snapshots are accepted as supplied
-- (same trust model as today, D9) but must be structurally valid and consistent with course_id.
create or replace function app.quotation_normalize_items(p_items jsonb)
returns jsonb
language plpgsql
set search_path = pg_catalog, public, app
as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_item jsonb;
  v_ord integer;
  v_prefix text;
  v_unit text;
  v_course_text text;
  v_course uuid;
  v_hrdf boolean;
  v_pkg jsonb;
  v_pkg_item jsonb;
  v_pkg_out jsonb;
  v_course_name text;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 100 then
    raise exception 'invalid_input:items' using errcode = 'P0001';
  end if;

  for v_item, v_ord in select e.item, e.ord::integer from jsonb_array_elements(p_items) with ordinality as e(item, ord) loop
    v_prefix := format('items[%s].', v_ord);
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'invalid_input:items[%]', v_ord using errcode = 'P0001';
    end if;

    v_unit := app.quotation_input_text(v_item -> 'unit', v_prefix || 'unit', 20, true);
    if v_unit not in ('pax', 'session', 'day', 'lot', 'unit') then
      raise exception 'invalid_input:%unit', v_prefix using errcode = 'P0001';
    end if;

    v_course_text := app.quotation_input_text(v_item -> 'course_id', v_prefix || 'course_id', 36);
    v_course := null;
    if v_course_text is not null then
      if v_course_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'invalid_input:%course_id', v_prefix using errcode = 'P0001';
      end if;
      v_course := v_course_text::uuid;
      if not exists (select 1 from public.courses where id = v_course) then
        raise exception 'invalid_input:%course_id', v_prefix using errcode = 'P0001';
      end if;
    end if;

    if v_item -> 'hrdf_claim' is null or jsonb_typeof(v_item -> 'hrdf_claim') = 'null' then
      v_hrdf := false;
    elsif jsonb_typeof(v_item -> 'hrdf_claim') = 'boolean' then
      v_hrdf := (v_item ->> 'hrdf_claim')::boolean;
    else
      raise exception 'invalid_input:%hrdf_claim', v_prefix using errcode = 'P0001';
    end if;

    v_course_name := app.quotation_input_text(v_item -> 'course_name_snapshot', v_prefix || 'course_name_snapshot', 500);

    v_pkg := coalesce(nullif(v_item -> 'package_includes_snapshot', 'null'::jsonb), '[]'::jsonb);
    if jsonb_typeof(v_pkg) <> 'array' or jsonb_array_length(v_pkg) > 50 then
      raise exception 'invalid_input:%package_includes_snapshot', v_prefix using errcode = 'P0001';
    end if;
    v_pkg_out := '[]'::jsonb;
    for v_pkg_item in select value from jsonb_array_elements(v_pkg) loop
      if jsonb_typeof(v_pkg_item) <> 'object' then
        raise exception 'invalid_input:%package_includes_snapshot', v_prefix using errcode = 'P0001';
      end if;
      v_pkg_out := v_pkg_out || jsonb_build_array(jsonb_build_object(
        'key', app.quotation_input_text(v_pkg_item -> 'key', v_prefix || 'package_includes_snapshot.key', 80, true),
        'label', app.quotation_input_text(v_pkg_item -> 'label', v_prefix || 'package_includes_snapshot.label', 200, true)
      ));
    end loop;

    -- Mirrors prepareQuotationItems(): HRDF and package snapshots need a course profile, and with a course every
    -- snapshot must agree with that course's commercial profile.
    if v_course is null and (v_hrdf or jsonb_array_length(v_pkg_out) > 0 or v_course_name is not null) then
      raise exception 'invalid_input:%course_id', v_prefix using errcode = 'P0001';
    end if;
    if v_course is not null then
      v_pkg_out := app.quotation_check_course_commercial(v_course, v_hrdf, v_course_name, v_pkg_out, v_prefix);
    end if;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'description', app.quotation_input_text(v_item -> 'description', v_prefix || 'description', 500, true),
      'quantity', app.quotation_input_numeric(v_item -> 'quantity', v_prefix || 'quantity', 0, 99999999.99, true),
      'unit', v_unit,
      'unit_price', app.quotation_input_numeric(v_item -> 'unit_price', v_prefix || 'unit_price', 0, 9999999999.99),
      'discount', app.quotation_input_numeric(v_item -> 'discount', v_prefix || 'discount', 0, 9999999999.99, false, 0),
      'sort_order', v_ord - 1,
      'course_id', v_course,
      'course_name_snapshot', v_course_name,
      'hrdf_claim', v_hrdf,
      'package_includes_snapshot', v_pkg_out
    ));
  end loop;
  return v_out;
end;
$$;

-- Exact decimal totals from normalised input. Same formula as the generated sales_quotation_items.line_total column
-- and the total arithmetic constraint: line = round(qty*price - discount, 2); taxable = subtotal - header discount;
-- tax = round(taxable * rate / 100, 2) when SST applies; total = taxable + tax. Postgres rounds numeric half away from zero.
create or replace function app.quotation_compute_totals(p_header jsonb, p_items jsonb)
returns jsonb
language plpgsql
set search_path = pg_catalog, public, app
as $$
declare
  v_subtotal numeric;
  v_negative integer;
  v_overflow integer;
  v_taxable numeric;
  v_tax numeric;
  v_total numeric;
  v_max constant numeric := 9999999999.99;
begin
  select
    coalesce(sum(round(i.quantity * i.unit_price - i.discount, 2)), 0),
    count(*) filter (where round(i.quantity * i.unit_price - i.discount, 2) < 0),
    count(*) filter (where abs(round(i.quantity * i.unit_price - i.discount, 2)) > v_max)
  into v_subtotal, v_negative, v_overflow
  from jsonb_to_recordset(p_items) as i(quantity numeric, unit_price numeric, discount numeric);

  if v_overflow > 0 then
    raise exception 'totals_invalid:out_of_range' using errcode = 'P0001';
  end if;
  -- D5: a negative line total (line discount larger than quantity x price) is rejected.
  if v_negative > 0 then
    raise exception 'totals_invalid:negative_line' using errcode = 'P0001';
  end if;

  v_taxable := v_subtotal - (p_header ->> 'discount')::numeric;
  if v_taxable < 0 then
    raise exception 'totals_invalid:discount_exceeds_subtotal' using errcode = 'P0001';
  end if;
  v_tax := case when (p_header ->> 'sst_applicable')::boolean
    then round(v_taxable * (p_header ->> 'sst_rate')::numeric / 100, 2) else 0 end;
  v_total := v_taxable + v_tax;
  if v_subtotal > v_max or v_total > v_max then
    raise exception 'totals_invalid:out_of_range' using errcode = 'P0001';
  end if;

  return jsonb_build_object('subtotal', round(v_subtotal, 2), 'tax', round(v_tax, 2), 'total', round(v_total, 2));
end;
$$;

-- Canonical fingerprint of a request: sha256 over the text of a jsonb built only from normalised, typed values.
create or replace function app.quotation_request_fingerprint(p_kind text, p_subject uuid, p_header jsonb, p_items jsonb)
returns text
language sql
immutable
set search_path = pg_catalog, public, app
as $$
  select encode(sha256(convert_to(
    jsonb_build_object('kind', p_kind, 'subject', p_subject, 'header', p_header, 'items', p_items)::text, 'UTF8')), 'hex');
$$;

-- Reserves (actor, request id) or replays it. Returns the stored quotation id on a replay of an identical request,
-- NULL when this call reserved the key. Same key with a different payload or kind raises idempotency_key_reused.
-- A concurrent duplicate waits on the primary-key index until the first call commits or rolls back, then replays.
create or replace function app.quotation_reserve_request(p_actor uuid, p_request_id uuid, p_kind text, p_fingerprint text)
returns uuid
language plpgsql
set search_path = pg_catalog, public, app
as $$
declare
  v_rows integer;
  v_existing record;
begin
  insert into public.sales_quotation_requests (created_by, request_id, kind, fingerprint)
  values (p_actor, p_request_id, p_kind, p_fingerprint)
  on conflict (created_by, request_id) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 1 then
    return null;
  end if;

  select r.kind, r.fingerprint, r.quotation_id into v_existing
  from public.sales_quotation_requests r
  where r.created_by = p_actor and r.request_id = p_request_id;
  if not found or v_existing.kind <> p_kind or v_existing.fingerprint <> p_fingerprint then
    raise exception 'idempotency_key_reused' using errcode = 'P0001';
  end if;
  if v_existing.quotation_id is null then
    -- The reserving call publishes its id in the same transaction, so this is not expected to be visible.
    raise exception 'request_in_progress' using errcode = 'P0001';
  end if;
  return v_existing.quotation_id;
end;
$$;

revoke all on function app.quotation_input_numeric(jsonb, text, numeric, numeric, boolean, numeric) from public, anon, authenticated;
revoke all on function app.quotation_input_text(jsonb, text, integer, boolean) from public, anon, authenticated;
revoke all on function app.quotation_check_course_commercial(uuid, boolean, text, jsonb, text) from public, anon, authenticated;
revoke all on function app.quotation_normalize_header(jsonb) from public, anon, authenticated;
revoke all on function app.quotation_normalize_items(jsonb) from public, anon, authenticated;
revoke all on function app.quotation_compute_totals(jsonb, jsonb) from public, anon, authenticated;
revoke all on function app.quotation_request_fingerprint(text, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function app.quotation_reserve_request(uuid, uuid, text, text) from public, anon, authenticated;

-- 3. create_quotation_with_items
-- Order: authorise -> validate (no write) -> reserve ledger -> lock opportunity -> insert header -> items -> stage ->
-- activity -> publish id on the ledger. Ledger first and opportunity second in EVERY RPC, so a duplicate request
-- never holds a lock another call is waiting for.
create or replace function public.create_quotation_with_items(
  p_opportunity_id uuid, p_header jsonb, p_items jsonb, p_request_id uuid
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, app
set lock_timeout = '15s'
as $$
declare
  v_actor uuid;
  v_header jsonb;
  v_items jsonb;
  v_totals jsonb;
  v_fingerprint text;
  v_replay uuid;
  v_opp record;
  v_co record;
  v_present jsonb;
  v_company_name text;
  v_contact_name text;
  v_registration_no text;
  v_email text;
  v_phone text;
  v_billing text;
  v_training_address text;
  v_id uuid;
  v_no text;
begin
  if not app.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_actor := auth.uid();
  if v_actor is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'unsupported_isolation_level' using errcode = 'P0001';
  end if;
  if p_opportunity_id is null or p_request_id is null then
    raise exception 'invalid_input:request' using errcode = 'P0001';
  end if;

  v_header := app.quotation_normalize_header(p_header);
  v_items := app.quotation_normalize_items(p_items);
  v_totals := app.quotation_compute_totals(v_header, v_items);
  -- Which customer fields the caller supplied decides whether the company/opportunity fallback applies, so it is part of
  -- the request identity: the same key with a field omitted versus sent empty is a different request.
  select coalesce(jsonb_agg(k order by k), '[]'::jsonb) into v_present
  from unnest(array['customer_company_name', 'customer_contact_name', 'customer_registration_no', 'customer_email',
    'customer_phone', 'billing_address', 'training_service_address']) as k
  where jsonb_exists(p_header, k);
  v_fingerprint := app.quotation_request_fingerprint('create', p_opportunity_id, v_header || jsonb_build_object('_present', v_present), v_items);

  v_replay := app.quotation_reserve_request(v_actor, p_request_id, 'create', v_fingerprint);
  if v_replay is not null then
    return v_replay;
  end if;

  select o.stage, o.lead_metadata_id, o.company_id, o.company_name, o.contact_person, o.contact_email, o.contact_phone into v_opp
  from public.sales_opportunities o
  where o.id = p_opportunity_id
  for update;
  if not found then
    raise exception 'opportunity_not_found' using errcode = 'P0001';
  end if;
  -- Same refusal as createQuotation today.
  if v_opp.stage in ('won', 'lost', 'cancelled') then
    raise exception 'opportunity_resolved' using errcode = 'P0001';
  end if;

  -- createQuotation prefills each customer field that was not submitted: company first, then the opportunity (first
  -- non-empty wins); training_service_address has no fallback. A field that WAS submitted, even empty, is used as sent.
  -- The left join always assigns v_co (all NULL when the opportunity has no company or the company is gone).
  select c.company_name, c.person_in_charge, c.registration_no, c.email, c.pic_email, c.phone, c.pic_phone, c.billing_address, c.address
    into v_co from (select 1) as one left join public.companies c on c.id = v_opp.company_id;
  v_company_name := case when jsonb_exists(p_header, 'customer_company_name') then v_header ->> 'customer_company_name'
    else coalesce(nullif(v_co.company_name, ''), nullif(v_opp.company_name, '')) end;
  v_contact_name := case when jsonb_exists(p_header, 'customer_contact_name') then v_header ->> 'customer_contact_name'
    else coalesce(nullif(v_co.person_in_charge, ''), nullif(v_opp.contact_person, '')) end;
  v_registration_no := case when jsonb_exists(p_header, 'customer_registration_no') then v_header ->> 'customer_registration_no'
    else nullif(v_co.registration_no, '') end;
  v_email := case when jsonb_exists(p_header, 'customer_email') then v_header ->> 'customer_email'
    else coalesce(nullif(v_co.email, ''), nullif(v_co.pic_email, ''), nullif(v_opp.contact_email, '')) end;
  v_phone := case when jsonb_exists(p_header, 'customer_phone') then v_header ->> 'customer_phone'
    else coalesce(nullif(v_co.phone, ''), nullif(v_co.pic_phone, ''), nullif(v_opp.contact_phone, '')) end;
  v_billing := case when jsonb_exists(p_header, 'billing_address') then v_header ->> 'billing_address'
    else coalesce(nullif(v_co.billing_address, ''), nullif(v_co.address, '')) end;
  v_training_address := v_header ->> 'training_service_address';

  insert into public.sales_quotations (
    opportunity_id, valid_until, currency, subtotal, discount, sst_applicable, sst_rate, sst_amount, tax, total,
    terms, notes, created_by, customer_company_name, customer_contact_name, customer_registration_no,
    customer_email, customer_phone, billing_address, training_service_address
  ) values (
    p_opportunity_id, (v_header ->> 'valid_until')::date, v_header ->> 'currency', (v_totals ->> 'subtotal')::numeric,
    (v_header ->> 'discount')::numeric, (v_header ->> 'sst_applicable')::boolean, (v_header ->> 'sst_rate')::numeric,
    (v_totals ->> 'tax')::numeric, (v_totals ->> 'tax')::numeric, (v_totals ->> 'total')::numeric,
    v_header ->> 'terms', v_header ->> 'notes', v_actor, v_company_name,
    v_contact_name, v_registration_no, v_email,
    v_phone, v_billing, v_training_address
  ) returning id, quotation_no into v_id, v_no;

  insert into public.sales_quotation_items (
    quotation_id, description, quantity, unit, unit_price, discount, sort_order,
    course_id, course_name_snapshot, hrdf_claim, package_includes_snapshot
  )
  select v_id, x.description, x.quantity, x.unit, x.unit_price, x.discount, x.sort_order,
         x.course_id, x.course_name_snapshot, x.hrdf_claim, x.package_includes_snapshot
  from jsonb_to_recordset(v_items) as x(
    description text, quantity numeric, unit text, unit_price numeric, discount numeric, sort_order integer,
    course_id uuid, course_name_snapshot text, hrdf_claim boolean, package_includes_snapshot jsonb
  )
  order by x.sort_order;

  -- D8: every stage that is not resolved becomes 'quotation', as createQuotation does today.
  update public.sales_opportunities
  set stage = 'quotation', updated_at = clock_timestamp()
  where id = p_opportunity_id;

  insert into public.sales_activity (lead_metadata_id, opportunity_id, quotation_id, type, note, actor_id)
  values (v_opp.lead_metadata_id, p_opportunity_id, v_id, 'quotation_created', v_no || ' created', v_actor);

  update public.sales_quotation_requests set quotation_id = v_id
  where created_by = v_actor and request_id = p_request_id;

  return v_id;
end;
$$;

-- 4. replace_quotation_draft
-- Replaces a draft's header and ALL its items in one transaction. p_expected_updated_at is the updated_at the editor
-- rendered; a different value means someone else changed the draft first (quotation_stale). Never changes
-- opportunity_id, quotation_no, revision_no or status. Writes no activity row, as the application does not today.
create or replace function public.replace_quotation_draft(
  p_quotation_id uuid, p_header jsonb, p_items jsonb, p_expected_updated_at timestamptz
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public, app
set lock_timeout = '15s'
as $$
declare
  v_header jsonb;
  v_items jsonb;
  v_totals jsonb;
  v_opportunity uuid;
  v_locked_opportunity uuid;
  v_status text;
  v_updated_at timestamptz;
begin
  if not app.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'unsupported_isolation_level' using errcode = 'P0001';
  end if;
  if p_quotation_id is null or p_expected_updated_at is null then
    raise exception 'invalid_input:request' using errcode = 'P0001';
  end if;

  v_header := app.quotation_normalize_header(p_header);
  v_items := app.quotation_normalize_items(p_items);
  v_totals := app.quotation_compute_totals(v_header, v_items);

  -- Lock protocol of accept_quotation: read the relationship, lock the opportunity, lock the quotation, re-check.
  select q.opportunity_id into v_opportunity from public.sales_quotations q where q.id = p_quotation_id;
  if v_opportunity is null then
    raise exception 'quotation_not_found' using errcode = 'P0001';
  end if;
  perform 1 from public.sales_opportunities o where o.id = v_opportunity for update;
  if not found then
    raise exception 'opportunity_not_found' using errcode = 'P0001';
  end if;
  select q.opportunity_id, q.status, q.updated_at into v_locked_opportunity, v_status, v_updated_at
  from public.sales_quotations q where q.id = p_quotation_id for update;
  if v_locked_opportunity is distinct from v_opportunity then
    raise exception 'quotation_opportunity_changed' using errcode = 'P0001';
  end if;
  if v_status is distinct from 'draft' then
    raise exception 'quotation_not_draft' using errcode = 'P0001';
  end if;
  if v_updated_at is distinct from p_expected_updated_at then
    raise exception 'quotation_stale' using errcode = 'P0001';
  end if;

  update public.sales_quotations
  set valid_until = (v_header ->> 'valid_until')::date,
      currency = v_header ->> 'currency',
      subtotal = (v_totals ->> 'subtotal')::numeric,
      discount = (v_header ->> 'discount')::numeric,
      sst_applicable = (v_header ->> 'sst_applicable')::boolean,
      sst_rate = (v_header ->> 'sst_rate')::numeric,
      sst_amount = (v_totals ->> 'tax')::numeric,
      tax = (v_totals ->> 'tax')::numeric,
      total = (v_totals ->> 'total')::numeric,
      terms = v_header ->> 'terms',
      notes = v_header ->> 'notes',
      customer_company_name = v_header ->> 'customer_company_name',
      customer_contact_name = v_header ->> 'customer_contact_name',
      customer_registration_no = v_header ->> 'customer_registration_no',
      customer_email = v_header ->> 'customer_email',
      customer_phone = v_header ->> 'customer_phone',
      billing_address = v_header ->> 'billing_address',
      training_service_address = v_header ->> 'training_service_address',
      -- clock_timestamp, not now(): two calls in one transaction must still produce different version tokens.
      updated_at = clock_timestamp()
  where id = p_quotation_id;

  delete from public.sales_quotation_items where quotation_id = p_quotation_id;
  insert into public.sales_quotation_items (
    quotation_id, description, quantity, unit, unit_price, discount, sort_order,
    course_id, course_name_snapshot, hrdf_claim, package_includes_snapshot
  )
  select p_quotation_id, x.description, x.quantity, x.unit, x.unit_price, x.discount, x.sort_order,
         x.course_id, x.course_name_snapshot, x.hrdf_claim, x.package_includes_snapshot
  from jsonb_to_recordset(v_items) as x(
    description text, quantity numeric, unit text, unit_price numeric, discount numeric, sort_order integer,
    course_id uuid, course_name_snapshot text, hrdf_claim boolean, package_includes_snapshot jsonb
  )
  order by x.sort_order;
end;
$$;

-- 5. create_quotation_revision
-- Lock order: ledger -> opportunity row -> family advisory lock (stable even when no row is contended) -> family
-- quotation rows by ascending id -> source items. The revision row and its items are inserted BEFORE the source is
-- marked superseded, all in one transaction, so a failure anywhere leaves the source exactly as it was.
-- Header, totals and SST snapshots are copied from the source, not recomputed.
create or replace function public.create_quotation_revision(p_source_quotation_id uuid, p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, app
set lock_timeout = '15s'
as $$
declare
  v_actor uuid;
  v_fingerprint text;
  v_replay uuid;
  v_opportunity uuid;
  v_quotation_no text;
  v_lead uuid;
  v_locked_opportunity uuid;
  v_status text;
  v_next integer;
  v_id uuid;
  v_new_no text;
begin
  if not app.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_actor := auth.uid();
  if v_actor is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'unsupported_isolation_level' using errcode = 'P0001';
  end if;
  if p_source_quotation_id is null or p_request_id is null then
    raise exception 'invalid_input:request' using errcode = 'P0001';
  end if;

  v_fingerprint := app.quotation_request_fingerprint('revise', p_source_quotation_id, '{}'::jsonb, '[]'::jsonb);
  v_replay := app.quotation_reserve_request(v_actor, p_request_id, 'revise', v_fingerprint);
  if v_replay is not null then
    return v_replay;
  end if;

  select q.opportunity_id, q.quotation_no into v_opportunity, v_quotation_no
  from public.sales_quotations q where q.id = p_source_quotation_id;
  if v_opportunity is null then
    raise exception 'quotation_not_found' using errcode = 'P0001';
  end if;

  select o.lead_metadata_id into v_lead from public.sales_opportunities o where o.id = v_opportunity for update;
  if not found then
    raise exception 'opportunity_not_found' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_quotation_no, 0));
  perform 1 from public.sales_quotations q where q.quotation_no = v_quotation_no order by q.id for update;

  -- Every row of the family hangs off the opportunity locked above. This is what makes "opportunity first" a total
  -- order for replace/send/accept/revise; a family spread over several opportunities would break it, so refuse.
  if exists (select 1 from public.sales_quotations q where q.quotation_no = v_quotation_no and q.opportunity_id is distinct from v_opportunity) then
    raise exception 'quotation_family_opportunity_mismatch' using errcode = 'P0001';
  end if;

  select q.opportunity_id, q.status into v_locked_opportunity, v_status
  from public.sales_quotations q where q.id = p_source_quotation_id;
  if v_locked_opportunity is distinct from v_opportunity or not found then
    raise exception 'quotation_opportunity_changed' using errcode = 'P0001';
  end if;
  if v_status not in ('sent', 'rejected', 'expired') then
    raise exception 'invalid_transition: only a sent, rejected or expired quotation can be revised (current status: %)', v_status using errcode = 'P0001';
  end if;

  select coalesce(max(q.revision_no), 0) + 1 into v_next from public.sales_quotations q where q.quotation_no = v_quotation_no;

  perform 1 from public.sales_quotation_items i where i.quotation_id = p_source_quotation_id order by i.sort_order, i.id for update;

  insert into public.sales_quotations (
    opportunity_id, quotation_no, revision_no, parent_quotation_id, valid_until, currency, subtotal, discount,
    sst_applicable, sst_rate, sst_amount, tax_label_snapshot, tax_basis_snapshot, sst_registration_number_snapshot,
    sst_effective_date_snapshot, tax, total, terms, notes, customer_company_name, customer_contact_name,
    customer_registration_no, customer_email, customer_phone, billing_address, training_service_address, created_by
  )
  select s.opportunity_id, s.quotation_no, v_next, s.id, s.valid_until, s.currency, s.subtotal, s.discount,
         s.sst_applicable, s.sst_rate, s.sst_amount, s.tax_label_snapshot, s.tax_basis_snapshot,
         s.sst_registration_number_snapshot, s.sst_effective_date_snapshot, s.tax, s.total, s.terms, s.notes,
         s.customer_company_name, s.customer_contact_name, s.customer_registration_no, s.customer_email,
         s.customer_phone, s.billing_address, s.training_service_address, v_actor
  from public.sales_quotations s
  where s.id = p_source_quotation_id
  returning id, quotation_no into v_id, v_new_no;

  insert into public.sales_quotation_items (
    quotation_id, description, quantity, unit, unit_price, discount, sort_order,
    course_id, course_name_snapshot, hrdf_claim, package_includes_snapshot
  )
  select v_id, i.description, i.quantity, i.unit, i.unit_price, i.discount, i.sort_order,
         i.course_id, i.course_name_snapshot, i.hrdf_claim, i.package_includes_snapshot
  from public.sales_quotation_items i
  where i.quotation_id = p_source_quotation_id
  order by i.sort_order, i.id;

  -- Last: only now, with the revision and its items in place, is the source superseded.
  update public.sales_quotations
  set status = 'superseded', superseded_at = clock_timestamp(), updated_at = clock_timestamp()
  where id = p_source_quotation_id and status = v_status;
  if not found then
    raise exception 'invalid_transition: the quotation changed while it was being revised' using errcode = 'P0001';
  end if;

  insert into public.sales_activity (lead_metadata_id, opportunity_id, quotation_id, type, note, actor_id)
  values (v_lead, v_opportunity, v_id, 'quotation_revised', v_new_no || ' revised', v_actor);

  update public.sales_quotation_requests set quotation_id = v_id
  where created_by = v_actor and request_id = p_request_id;

  return v_id;
end;
$$;

-- 6. mark_quotation_sent
-- Manual draft -> sent transition (no email is sent, as today). A second call finds the quotation already sent and
-- raises invalid_transition. D6: no extra send validation.
create or replace function public.mark_quotation_sent(p_quotation_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, app
set lock_timeout = '15s'
as $$
declare
  v_actor uuid;
  v_opportunity uuid;
  v_locked_opportunity uuid;
  v_lead uuid;
  v_status text;
  v_no text;
begin
  if not app.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_actor := auth.uid();
  if v_actor is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'unsupported_isolation_level' using errcode = 'P0001';
  end if;
  if p_quotation_id is null then
    raise exception 'invalid_input:request' using errcode = 'P0001';
  end if;

  select q.opportunity_id into v_opportunity from public.sales_quotations q where q.id = p_quotation_id;
  if v_opportunity is null then
    raise exception 'quotation_not_found' using errcode = 'P0001';
  end if;
  select o.lead_metadata_id into v_lead from public.sales_opportunities o where o.id = v_opportunity for update;
  if not found then
    raise exception 'opportunity_not_found' using errcode = 'P0001';
  end if;
  select q.opportunity_id, q.status, q.quotation_no into v_locked_opportunity, v_status, v_no
  from public.sales_quotations q where q.id = p_quotation_id for update;
  if v_locked_opportunity is distinct from v_opportunity then
    raise exception 'quotation_opportunity_changed' using errcode = 'P0001';
  end if;
  if v_status is distinct from 'draft' then
    raise exception 'invalid_transition: only a draft quotation can be marked as sent (current status: %)', v_status using errcode = 'P0001';
  end if;

  update public.sales_quotations
  set status = 'sent', sent_at = clock_timestamp(), updated_at = clock_timestamp()
  where id = p_quotation_id;

  insert into public.sales_activity (lead_metadata_id, opportunity_id, quotation_id, type, note, actor_id)
  values (v_lead, v_opportunity, p_quotation_id, 'quotation_sent', v_no || ' marked as sent', v_actor);
end;
$$;

-- 7. Grants: authenticated only; the admin check inside each function is the real gate.
revoke all on function public.create_quotation_with_items(uuid, jsonb, jsonb, uuid) from public, anon;
revoke all on function public.replace_quotation_draft(uuid, jsonb, jsonb, timestamptz) from public, anon;
revoke all on function public.create_quotation_revision(uuid, uuid) from public, anon;
revoke all on function public.mark_quotation_sent(uuid) from public, anon;
grant execute on function public.create_quotation_with_items(uuid, jsonb, jsonb, uuid) to authenticated;
grant execute on function public.replace_quotation_draft(uuid, jsonb, jsonb, timestamptz) to authenticated;
grant execute on function public.create_quotation_revision(uuid, uuid) to authenticated;
grant execute on function public.mark_quotation_sent(uuid) to authenticated;

comment on function public.create_quotation_with_items(uuid, jsonb, jsonb, uuid) is
  'Atomic quotation create: header + items + opportunity stage + activity + idempotency ledger in one transaction. Admin only.';
comment on function public.replace_quotation_draft(uuid, jsonb, jsonb, timestamptz) is
  'Atomic replace of a draft header and all items; stale-edit protected by the expected updated_at. Admin only.';
comment on function public.create_quotation_revision(uuid, uuid) is
  'Atomic revision: new draft + items, then source superseded, + activity + idempotency ledger. Admin only.';
comment on function public.mark_quotation_sent(uuid) is
  'Atomic draft -> sent transition with activity row. Admin only.';
