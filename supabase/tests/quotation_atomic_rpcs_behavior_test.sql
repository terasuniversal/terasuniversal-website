-- Behaviour suite for the DRAFT quotation atomic RPCs (supabase/post_baseline_drafts/20260913090000_quotation_atomic_rpcs.sql).
-- DISPOSABLE DATABASE ONLY: it inserts auth.users fixtures. Never run it against Staging or Production.
-- Run after Baseline V2 + P1 + P2 + P3 + the M4 draft, as role postgres:
--   psql -U postgres -v ON_ERROR_STOP=1 -q -f quotation_atomic_rpcs_behavior_test.sql
-- Every row is created inside one transaction that ends in ROLLBACK. An assertion failure raises
-- 'assertion_failed: ...' and stops the script (non-zero exit).

begin;

-- Fixtures -----------------------------------------------------------------
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'qa-admin1@local.test', 'x', now(), '{}', '{}'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'qa-admin2@local.test', 'x', now(), '{}', '{}'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'qa-trainer@local.test', 'x', now(), '{}', '{}')
on conflict (id) do nothing;
insert into public.profiles (id, email, full_name, role, is_active) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'qa-admin1@local.test', 'QA Admin One', 'super_admin', true),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'qa-admin2@local.test', 'QA Admin Two', 'admin', true),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'qa-trainer@local.test', 'QA Trainer', 'trainer', true)
on conflict (id) do update set role = excluded.role, is_active = true;

insert into public.sales_lead_metadata (id, lead_source, source_id)
select ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 'enquiry', ('10000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
from generate_series(1, 14) as g(n);
insert into public.sales_opportunities (id, lead_metadata_id, title, stage)
select ('20000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
       'QA opportunity ' || n,
       (array['qualified','qualified','qualified','qualified','qualified','lost','qualified','new','negotiation','archived','quotation','qualified','qualified','qualified'])[n]
from generate_series(1, 14) as g(n);
-- won and cancelled can only be reached through the governed transition marker (the revenue guard), so set them the governed way.
select set_config('app.sales_revenue_transition', 'accept', true);
update public.sales_opportunities set stage = 'won' where id = '20000000-0000-0000-0000-000000000005';
select set_config('app.sales_revenue_transition', 'reverse', true);
update public.sales_opportunities set stage = 'cancelled' where id = '20000000-0000-0000-0000-000000000007';
select set_config('app.sales_revenue_transition', '', true);
insert into public.courses (id, title, slug) values
  ('40000000-0000-0000-0000-000000000001', 'QA Course', 'qa-atomic-rpc-course'),
  ('40000000-0000-0000-0000-000000000002', 'QA No Profile', 'qa-no-profile'),
  ('40000000-0000-0000-0000-000000000003', 'QA Not Claimable', 'qa-not-claimable'),
  ('40000000-0000-0000-0000-000000000004', 'QA Blank HRDF Name', 'qa-blank-hrdf'),
  ('40000000-0000-0000-0000-000000000005', 'QA Unicode Package', 'qa-unicode-package'),
  ('40000000-0000-0000-0000-000000000006', 'QA NBSP HRDF Name', 'qa-nbsp-hrdf');
insert into public.course_commercial_profiles (course_id, standard_display_name, hrdf_display_name, hrdf_claimable, quotation_description, package_includes,
  accommodation_included_default, accommodation_description_default, meals_included_default, meals_description_default) values
  ('40000000-0000-0000-0000-000000000001', 'QA Course', 'QA Course (HRDF)', true, 'desc', '["Lunch", {"key":"snacks","label":"Tea break"}, 7, {"label":"Notes pack"}]'::jsonb, true, 'Hotel stay', false, null),
  ('40000000-0000-0000-0000-000000000003', 'QA Not Claimable', 'QA NC (HRDF)', false, 'desc', '[]'::jsonb, false, null, false, null),
  ('40000000-0000-0000-0000-000000000004', 'QA Blank HRDF Name', '   ', true, 'desc', '[]'::jsonb, false, null, false, null),
  ('40000000-0000-0000-0000-000000000005', 'QA Unicode Package', null, false, 'desc', '["Café", "Plain Item", {"key":"x_key","label":"Café explicit"}]'::jsonb, false, null, false, null),
  ('40000000-0000-0000-0000-000000000006', 'QA NBSP HRDF Name', chr(160) || chr(8195), true, 'desc', '[]'::jsonb, false, null, false, null);
insert into public.companies (id, company_name, registration_no, email, pic_email, phone, pic_phone, person_in_charge, billing_address, address) values
  ('50000000-0000-0000-0000-000000000001', 'Fallback Co', 'REG-1', '', 'pic@co.test', null, '011-1111', 'Co PIC', null, 'Co Address 1');
insert into public.sales_lead_metadata (id, lead_source, source_id) values
  ('00000000-0000-0000-0000-000000000015', 'enquiry', '10000000-0000-0000-0000-000000000015'),
  ('00000000-0000-0000-0000-000000000016', 'enquiry', '10000000-0000-0000-0000-000000000016');
insert into public.sales_opportunities (id, lead_metadata_id, title, stage, company_id, company_name, contact_person, contact_email, contact_phone) values
  ('20000000-0000-0000-0000-000000000015', '00000000-0000-0000-0000-000000000015', 'QA with company', 'qualified', '50000000-0000-0000-0000-000000000001', 'Opp Co', 'Opp Person', 'opp@x.test', '012-2222'),
  ('20000000-0000-0000-0000-000000000016', '00000000-0000-0000-0000-000000000016', 'QA no company', 'qualified', null, 'Opp Only Co', 'Opp Only Person', 'only@x.test', '013-3333');

-- Helpers (session-local) ---------------------------------------------------
create function pg_temp.qa_err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'NO_ERROR';
exception when others then
  return sqlstate || '|' || sqlerrm;
end;
$$;
create function pg_temp.qa_assert(p_ok boolean, p_what text) returns void language plpgsql as $$
begin
  if p_ok is not true then raise exception 'assertion_failed: %', p_what; end if;
end;
$$;
create function pg_temp.qa_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.qa_state() returns text language sql as $$
  select (select count(*) from public.sales_quotations) || '/' || (select count(*) from public.sales_quotation_items)
      || '/' || (select count(*) from public.sales_activity) || '/' || (select count(*) from public.sales_quotation_requests);
$$;

create function pg_temp.qa_header(p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object(
    'customer_company_name', 'QA Sdn Bhd', 'customer_contact_name', 'QA Contact', 'customer_registration_no', '202001000001',
    'customer_email', 'buyer@qa.example', 'customer_phone', '0123456789', 'billing_address', 'QA billing', 'training_service_address', 'QA site',
    'valid_until', '2030-01-31', 'currency', 'MYR', 'discount', 0.02, 'sst_applicable', true, 'sst_rate', 8, 'terms', 'QA terms', 'notes', 'QA notes'
  ) || p_extra;
$$;
create function pg_temp.qa_items() returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('description', 'Line A', 'quantity', 3, 'unit', 'pax', 'unit_price', 10.33, 'discount', 0.99,
      'course_id', '40000000-0000-0000-0000-000000000001', 'course_name_snapshot', 'QA Course (HRDF)', 'hrdf_claim', true,
      'package_includes_snapshot', jsonb_build_array(jsonb_build_object('key', 'lunch', 'label', 'Lunch'))),
    jsonb_build_object('description', 'Line B', 'quantity', 1.5, 'unit', 'session', 'unit_price', 0.01, 'discount', 0)
  );
$$;

-- 1. Privilege model --------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.create_quotation_with_items(uuid,jsonb,jsonb,uuid)', 'public.replace_quotation_draft(uuid,jsonb,jsonb,timestamptz)',
    'public.create_quotation_revision(uuid,uuid)', 'public.mark_quotation_sent(uuid)'] loop
    perform pg_temp.qa_assert(has_function_privilege('authenticated', f, 'execute'), f || ' executable by authenticated');
    perform pg_temp.qa_assert(not has_function_privilege('anon', f, 'execute'), f || ' not executable by anon');
    perform pg_temp.qa_assert(not has_function_privilege('public', f, 'execute'), f || ' not executable by PUBLIC');
    perform pg_temp.qa_assert((select p.prosecdef from pg_proc p where p.oid = f::regprocedure), f || ' is security definer');
    perform pg_temp.qa_assert((select pg_get_userbyid(p.proowner) = 'postgres' from pg_proc p where p.oid = f::regprocedure), f || ' owned by postgres');
    perform pg_temp.qa_assert((select p.proconfig::text like '%search_path=pg_catalog, public, app%' from pg_proc p where p.oid = f::regprocedure), f || ' pins search_path');
  end loop;
  foreach f in array array[
    'app.quotation_input_numeric(jsonb,text,numeric,numeric,boolean,numeric)', 'app.quotation_input_text(jsonb,text,integer,boolean)',
    'app.quotation_normalize_header(jsonb)', 'app.quotation_normalize_items(jsonb)', 'app.quotation_compute_totals(jsonb,jsonb)',
    'app.quotation_request_fingerprint(text,uuid,jsonb,jsonb)', 'app.quotation_reserve_request(uuid,uuid,text,text)'] loop
    perform pg_temp.qa_assert(not has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute') and not has_function_privilege('public', f, 'execute'), f || ' is internal only');
  end loop;
  perform pg_temp.qa_assert(not has_table_privilege('authenticated', 'public.sales_quotation_requests', 'select')
    and not has_table_privilege('authenticated', 'public.sales_quotation_requests', 'insert')
    and not has_table_privilege('anon', 'public.sales_quotation_requests', 'select'), 'ledger has no client privileges');
  perform pg_temp.qa_assert((select relrowsecurity from pg_class where oid = 'public.sales_quotation_requests'::regclass), 'ledger has RLS enabled');
  perform pg_temp.qa_assert((select count(*) from pg_policy where polrelid = 'public.sales_quotation_requests'::regclass) = 0, 'ledger has no client policy');
end $$;

-- 2. Authorisation: no user, a trainer, and an inactive admin are all refused with 42501 ---------------------------------
do $$
declare
  v_call text := 'select public.create_quotation_with_items(''20000000-0000-0000-0000-000000000001'', pg_temp.qa_header(), pg_temp.qa_items(), gen_random_uuid())';
  v_before text := pg_temp.qa_state();
begin
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.qa_assert(pg_temp.qa_err(v_call) like '42501|forbidden', 'no user is refused');
  perform pg_temp.qa_as('aaaaaaaa-0000-0000-0000-000000000003');
  perform pg_temp.qa_assert(pg_temp.qa_err(v_call) like '42501|forbidden', 'trainer is refused');
  perform pg_temp.qa_assert(pg_temp.qa_err('select public.mark_quotation_sent(gen_random_uuid())') like '42501|forbidden', 'trainer cannot mark sent');
  perform pg_temp.qa_assert(pg_temp.qa_err('select public.create_quotation_revision(gen_random_uuid(), gen_random_uuid())') like '42501|forbidden', 'trainer cannot revise');
  perform pg_temp.qa_assert(pg_temp.qa_err('select public.replace_quotation_draft(gen_random_uuid(), pg_temp.qa_header(), pg_temp.qa_items(), now())') like '42501|forbidden', 'trainer cannot replace');
  update public.profiles set is_active = false where id = 'aaaaaaaa-0000-0000-0000-000000000002';
  perform pg_temp.qa_as('aaaaaaaa-0000-0000-0000-000000000002');
  perform pg_temp.qa_assert(pg_temp.qa_err(v_call) like '42501|forbidden', 'inactive admin is refused');
  update public.profiles set is_active = true where id = 'aaaaaaaa-0000-0000-0000-000000000002';
  perform pg_temp.qa_assert(pg_temp.qa_state() = v_before, 'refused calls wrote nothing');
end $$;

-- 3. create: happy path with exact decimals ---------------------------------------------------------------------------------
do $$
declare
  v_id uuid;
  q record;
  v_req uuid := gen_random_uuid();
begin
  perform pg_temp.qa_as('aaaaaaaa-0000-0000-0000-000000000001');
  v_id := public.create_quotation_with_items('20000000-0000-0000-0000-000000000001', pg_temp.qa_header(), pg_temp.qa_items(), v_req);
  select * into q from public.sales_quotations where id = v_id;
  perform pg_temp.qa_assert(q.status = 'draft' and q.revision_no = 0 and q.quotation_no like 'QT-%', 'draft, revision 0, numbered');
  -- Line A = 3 x 10.33 - 0.99 = 30.00; Line B = 1.5 x 0.01 = 0.015 -> 0.02 (half away from zero); subtotal 30.02; taxable 30.00; SST 8% = 2.40.
  perform pg_temp.qa_assert(q.subtotal = 30.02 and q.discount = 0.02 and q.tax = 2.40 and q.sst_amount = 2.40 and q.total = 32.40, format('exact totals, got %s/%s/%s/%s', q.subtotal, q.discount, q.tax, q.total));
  perform pg_temp.qa_assert(q.sst_applicable and q.sst_rate = 8 and q.tax_label_snapshot is null and q.tax_basis_snapshot is null and q.sst_registration_number_snapshot is null and q.sst_effective_date_snapshot is null, 'SST snapshots stay NULL as today');
  perform pg_temp.qa_assert(q.created_by = 'aaaaaaaa-0000-0000-0000-000000000001' and q.customer_company_name = 'QA Sdn Bhd' and q.valid_until = date '2030-01-31', 'actor and header stored');
  perform pg_temp.qa_assert((select count(*) from public.sales_quotation_items where quotation_id = v_id) = 2, 'two items');
  perform pg_temp.qa_assert((select sum(line_total) from public.sales_quotation_items where quotation_id = v_id) = q.subtotal, 'sum of generated line totals equals subtotal');
  perform pg_temp.qa_assert((select description from public.sales_quotation_items where quotation_id = v_id and sort_order = 0) = 'Line A'
    and (select hrdf_claim from public.sales_quotation_items where quotation_id = v_id and sort_order = 0)
    and (select package_includes_snapshot from public.sales_quotation_items where quotation_id = v_id and sort_order = 0) = '[{"key":"lunch","label":"Lunch"}]'::jsonb, 'order and commercial snapshots stored');
  perform pg_temp.qa_assert((select stage from public.sales_opportunities where id = '20000000-0000-0000-0000-000000000001') = 'quotation', 'opportunity moved to quotation');
  perform pg_temp.qa_assert((select count(*) from public.sales_activity where quotation_id = v_id and type = 'quotation_created' and actor_id = q.created_by) = 1, 'one audit row');
  perform pg_temp.qa_assert((select quotation_id from public.sales_quotation_requests where created_by = q.created_by and request_id = v_req) = v_id, 'ledger row published');
end $$;

-- 3b. A half-cent tax rounds away from zero and the stored arithmetic constraint holds (0.25 x 6% = 0.015 -> 0.02) -------
do $$
declare
  v_id uuid;
begin
  v_id := public.create_quotation_with_items('20000000-0000-0000-0000-000000000002',
    pg_temp.qa_header('{"discount":0,"sst_rate":6}'),
    '[{"description":"Half cent","quantity":1,"unit":"lot","unit_price":0.25,"discount":0}]', gen_random_uuid());
  perform pg_temp.qa_assert((select tax = 0.02 and total = 0.27 and subtotal = 0.25 from public.sales_quotations where id = v_id), 'half-cent tax rounds up');
  v_id := public.create_quotation_with_items('20000000-0000-0000-0000-000000000003',
    pg_temp.qa_header('{"sst_applicable":false,"sst_rate":6,"discount":0}'),
    '[{"description":"No tax","quantity":2,"unit":"day","unit_price":100,"discount":0}]', gen_random_uuid());
  perform pg_temp.qa_assert((select tax = 0 and sst_amount = 0 and sst_rate = 0 and total = 200 and not sst_applicable from public.sales_quotations where id = v_id), 'SST off stores rate 0 and tax 0');
end $$;

-- 4. Idempotency ------------------------------------------------------------------------------------------------------------
do $$
declare
  v_req uuid := gen_random_uuid();
  v_first uuid;
  v_again uuid;
  v_state text;
begin
  v_first := public.create_quotation_with_items('20000000-0000-0000-0000-000000000004', pg_temp.qa_header(), pg_temp.qa_items(), v_req);
  v_state := pg_temp.qa_state();
  v_again := public.create_quotation_with_items('20000000-0000-0000-0000-000000000004', pg_temp.qa_header(), pg_temp.qa_items(), v_req);
  perform pg_temp.qa_assert(v_again = v_first, 'replay returns the same id');
  perform pg_temp.qa_assert(pg_temp.qa_state() = v_state, 'replay writes nothing');
  perform pg_temp.qa_assert(pg_temp.qa_err(format('select public.create_quotation_with_items(%L, pg_temp.qa_header(%L), pg_temp.qa_items(), %L)',
    '20000000-0000-0000-0000-000000000004', '{"notes":"changed"}', v_req)) like 'P0001|idempotency_key_reused', 'same key, different header is refused');
  perform pg_temp.qa_assert(pg_temp.qa_err(format('select public.create_quotation_with_items(%L, pg_temp.qa_header(), pg_temp.qa_items(), %L)',
    '20000000-0000-0000-0000-000000000001', v_req)) like 'P0001|idempotency_key_reused', 'same key, different opportunity is refused');
  perform pg_temp.qa_assert(pg_temp.qa_err(format('select public.create_quotation_revision(%L, %L)', v_first, v_req)) like 'P0001|idempotency_key_reused', 'same key, different kind is refused');
  perform pg_temp.qa_assert(pg_temp.qa_state() = v_state, 'refused replays write nothing');
  -- The key is scoped per actor: another admin may use the same uuid.
  perform pg_temp.qa_as('aaaaaaaa-0000-0000-0000-000000000002');
  v_again := public.create_quotation_with_items('20000000-0000-0000-0000-000000000004', pg_temp.qa_header(), pg_temp.qa_items(), v_req);
  perform pg_temp.qa_assert(v_again <> v_first, 'another actor with the same uuid creates its own quotation');
  perform pg_temp.qa_as('aaaaaaaa-0000-0000-0000-000000000001');
end $$;

-- 4b. Equivalent numeric spellings fingerprint identically (1, 1.00 and "1.0" are the same request) -------------------------
do $$
declare
  v_req uuid := gen_random_uuid();
  v_first uuid;
  v_state text;
begin
  v_first := public.create_quotation_with_items('20000000-0000-0000-0000-000000000004', pg_temp.qa_header('{"discount":0,"sst_rate":6}'),
    '[{"description":"Spelling","quantity":1,"unit":"pax","unit_price":10,"discount":0}]', v_req);
  v_state := pg_temp.qa_state();
  perform pg_temp.qa_assert(public.create_quotation_with_items('20000000-0000-0000-0000-000000000004', pg_temp.qa_header('{"discount":0.00,"sst_rate":6.0}'),
    '[{"description":"Spelling","quantity":"1.00","unit":"pax","unit_price":10.0,"discount":"0"}]', v_req) = v_first, 'equivalent numeric spellings replay');
  perform pg_temp.qa_assert(pg_temp.qa_state() = v_state, 'equivalent replay wrote nothing');
end $$;

-- 5. Validation: every bad input is refused with nothing written ---------------------------------------------------------------
do $$
declare
  r record;
  v_state text := pg_temp.qa_state();
  v_stage text := (select stage from public.sales_opportunities where id = '20000000-0000-0000-0000-000000000012');
  v_item text := '{"description":"x","quantity":1,"unit":"pax","unit_price":10,"discount":0}';
begin
  for r in select * from (values
    ('negative unit price', pg_temp.qa_header(), ('[' || replace(v_item, '"unit_price":10', '"unit_price":-1') || ']'), 'invalid_input:items[1].unit_price'),
    ('3-decimal price', pg_temp.qa_header(), ('[' || replace(v_item, '"unit_price":10', '"unit_price":1.005') || ']'), 'invalid_input:items[1].unit_price'),
    ('zero quantity', pg_temp.qa_header(), ('[' || replace(v_item, '"quantity":1', '"quantity":0') || ']'), 'invalid_input:items[1].quantity'),
    ('bad unit', pg_temp.qa_header(), ('[' || replace(v_item, '"pax"', '"box"') || ']'), 'invalid_input:items[1].unit'),
    ('blank description', pg_temp.qa_header(), ('[' || replace(v_item, '"x"', '"   "') || ']'), 'invalid_input:items[1].description'),
    ('no items', pg_temp.qa_header(), '[]', 'invalid_input:items'),
    ('items not array', pg_temp.qa_header(), '{}', 'invalid_input:items'),
    ('bad email', pg_temp.qa_header('{"customer_email":"nope"}'), ('[' || v_item || ']'), 'invalid_input:customer_email'),
    ('impossible date', pg_temp.qa_header('{"valid_until":"2026-02-31"}'), ('[' || v_item || ']'), 'invalid_input:valid_until'),
    ('currency too long', pg_temp.qa_header('{"currency":"ABCDEFGHIJK"}'), ('[' || v_item || ']'), 'invalid_input:currency'),
    ('negative header discount', pg_temp.qa_header('{"discount":-1}'), ('[' || v_item || ']'), 'invalid_input:discount'),
    ('discount above subtotal', pg_temp.qa_header('{"discount":10.01}'), ('[' || v_item || ']'), 'totals_invalid:discount_exceeds_subtotal'),
    ('negative line (D5)', pg_temp.qa_header('{"discount":0}'), ('[' || replace(v_item, '"discount":0', '"discount":10.01') || ']'), 'totals_invalid:negative_line'),
    ('unknown course', pg_temp.qa_header(), ('[' || replace(v_item, '"unit":"pax"', '"unit":"pax","course_id":"99999999-9999-9999-9999-999999999999"') || ']'), 'invalid_input:items[1].course_id'),
    ('malformed course id', pg_temp.qa_header(), ('[' || replace(v_item, '"unit":"pax"', '"unit":"pax","course_id":"abc"') || ']'), 'invalid_input:items[1].course_id'),
    ('HRDF without course', pg_temp.qa_header(), ('[' || replace(v_item, '"unit":"pax"', '"unit":"pax","hrdf_claim":true') || ']'), 'invalid_input:items[1].course_id'),
    ('package without course', pg_temp.qa_header(), ('[' || replace(v_item, '"unit":"pax"', '"unit":"pax","package_includes_snapshot":[{"key":"a","label":"b"}]') || ']'), 'invalid_input:items[1].course_id'),
    ('package key too long', pg_temp.qa_header(), ('[' || replace(v_item, '"unit":"pax"', '"unit":"pax","course_id":"40000000-0000-0000-0000-000000000001","package_includes_snapshot":[{"key":"' || repeat('k', 81) || '","label":"b"}]') || ']'), 'invalid_input:items[1].package_includes_snapshot.key'),
    ('quantity above numeric(10,2)', pg_temp.qa_header('{"discount":0}'), ('[' || replace(v_item, '"quantity":1', '"quantity":100000000') || ']'), 'invalid_input:items[1].quantity'),
    ('line total overflow', pg_temp.qa_header('{"discount":0}'), ('[' || replace(replace(v_item, '"quantity":1', '"quantity":99999999.99'), '"unit_price":10', '"unit_price":9999999999.99') || ']'), 'totals_invalid:out_of_range'),
    ('SST rate above 100', pg_temp.qa_header('{"sst_rate":100.01}'), ('[' || v_item || ']'), 'invalid_input:sst_rate')
  ) as t(name, header, items, expected)
  loop
    perform pg_temp.qa_assert(
      pg_temp.qa_err(format('select public.create_quotation_with_items(%L, %L::jsonb, %L::jsonb, gen_random_uuid())', '20000000-0000-0000-0000-000000000012', r.header, r.items)) = 'P0001|' || r.expected,
      format('%s -> %s (got %s)', r.name, r.expected, pg_temp.qa_err(format('select public.create_quotation_with_items(%L, %L::jsonb, %L::jsonb, gen_random_uuid())', '20000000-0000-0000-0000-000000000012', r.header, r.items))));
  end loop;
  perform pg_temp.qa_assert(pg_temp.qa_state() = v_state, 'no rejected input wrote anything');
  perform pg_temp.qa_assert((select stage from public.sales_opportunities where id = '20000000-0000-0000-0000-000000000012') = v_stage, 'stage untouched by rejected input');
  perform pg_temp.qa_assert(pg_temp.qa_err('select public.create_quotation_with_items(null, pg_temp.qa_header(), pg_temp.qa_items(), gen_random_uuid())') = 'P0001|invalid_input:request', 'null opportunity refused');
  perform pg_temp.qa_assert(pg_temp.qa_err('select public.create_quotation_with_items(''20000000-0000-0000-0000-000000000012'', pg_temp.qa_header(), pg_temp.qa_items(), null)') = 'P0001|invalid_input:request', 'null request id refused');
  perform pg_temp.qa_assert(pg_temp.qa_err('select public.create_quotation_with_items(''20000000-0000-0000-0000-000000000012'', ''[]''::jsonb, pg_temp.qa_items(), gen_random_uuid())') = 'P0001|invalid_input:header', 'non-object header refused');
end $$;

-- 5b. Course commercial snapshots must agree with the course profile (reject-only, as the application does) --------------------
do $$
declare
  v_opp text := '20000000-0000-0000-0000-000000000012';
  v_state text := pg_temp.qa_state();
  v_id uuid;
  r record;
begin
  for r in select * from (values
    ('course without a profile', '"course_id":"40000000-0000-0000-0000-000000000002","course_name_snapshot":"x"', 'invalid_input:items[1].course_profile'),
    ('HRDF on a non-claimable course', '"course_id":"40000000-0000-0000-0000-000000000003","course_name_snapshot":"QA NC (HRDF)","hrdf_claim":true', 'invalid_input:items[1].hrdf_claim'),
    ('HRDF with a blank HRDF display name', '"course_id":"40000000-0000-0000-0000-000000000004","course_name_snapshot":"QA Blank HRDF Name","hrdf_claim":true', 'invalid_input:items[1].hrdf_claim'),
    ('stale or forged course name (no HRDF)', '"course_id":"40000000-0000-0000-0000-000000000001","course_name_snapshot":"QA Course (HRDF)"', 'invalid_input:items[1].course_name_snapshot'),
    ('standard name sent with HRDF on', '"course_id":"40000000-0000-0000-0000-000000000001","course_name_snapshot":"QA Course","hrdf_claim":true', 'invalid_input:items[1].course_name_snapshot'),
    ('course item without any name snapshot', '"course_id":"40000000-0000-0000-0000-000000000001"', 'invalid_input:items[1].course_name_snapshot'),
    ('package key not configured for the course', '"course_id":"40000000-0000-0000-0000-000000000001","course_name_snapshot":"QA Course","package_includes_snapshot":[{"key":"limo","label":"Limo"}]', 'invalid_input:items[1].package_includes_snapshot'),
    ('HRDF name that is only Unicode whitespace is blank, as JavaScript trim() sees it', '"course_id":"40000000-0000-0000-0000-000000000006","course_name_snapshot":"QA NBSP HRDF Name","hrdf_claim":true', 'invalid_input:items[1].hrdf_claim'),
    ('key derived from a non-ASCII label is not allowed (fail-closed)', '"course_id":"40000000-0000-0000-0000-000000000005","course_name_snapshot":"QA Unicode Package","package_includes_snapshot":[{"key":"caf","label":"Cafe"}]', 'invalid_input:items[1].package_includes_snapshot'),
    ('meals offered but not described by the profile', '"course_id":"40000000-0000-0000-0000-000000000001","course_name_snapshot":"QA Course","package_includes_snapshot":[{"key":"meals","label":"Meals"}]', 'invalid_input:items[1].package_includes_snapshot')
  ) as t(name, fields, expected)
  loop
    perform pg_temp.qa_assert(
      pg_temp.qa_err(format('select public.create_quotation_with_items(%L, pg_temp.qa_header(%L), %L::jsonb, gen_random_uuid())', v_opp, '{"discount":0}',
        '[{"description":"c","quantity":1,"unit":"pax","unit_price":10,' || r.fields || '}]')) = 'P0001|' || r.expected,
      r.name || ' -> ' || r.expected);
  end loop;
  perform pg_temp.qa_assert(pg_temp.qa_state() = v_state, 'rejected course snapshots wrote nothing');

  -- Accepted: strings and {key,label} entries slug to keys; accommodation is allowed through its description; the label is
  -- stored as submitted (the application does not compare labels); a repeated key is kept once, first wins.
  v_id := public.create_quotation_with_items(v_opp::uuid, pg_temp.qa_header('{"discount":0}'),
    '[{"description":"c","quantity":1,"unit":"pax","unit_price":10,"course_id":"40000000-0000-0000-0000-000000000001","course_name_snapshot":"QA Course (HRDF)","hrdf_claim":true,
       "package_includes_snapshot":[{"key":"lunch","label":"Our lunch"},{"key":"snacks","label":"Tea break"},{"key":"notes_pack","label":"Notes pack"},{"key":"accommodation","label":"Hotel stay"},{"key":"lunch","label":"dup"}]}]',
    gen_random_uuid());
  perform pg_temp.qa_assert((select package_includes_snapshot = '[{"key":"lunch","label":"Our lunch"},{"key":"snacks","label":"Tea break"},{"key":"notes_pack","label":"Notes pack"},{"key":"accommodation","label":"Hotel stay"}]'::jsonb
    and course_name_snapshot = 'QA Course (HRDF)' and hrdf_claim from public.sales_quotation_items where quotation_id = v_id), 'valid course snapshots stored, duplicate key dropped');
  -- ASCII-derived and explicit keys on a profile that also has a non-ASCII label are still allowed.
  perform public.create_quotation_with_items(v_opp::uuid, pg_temp.qa_header('{"discount":0}'),
    '[{"description":"u","quantity":1,"unit":"pax","unit_price":10,"course_id":"40000000-0000-0000-0000-000000000005","course_name_snapshot":"QA Unicode Package","package_includes_snapshot":[{"key":"plain_item","label":"Plain Item"},{"key":"x_key","label":"x"}]}]', gen_random_uuid());
  -- The same rules apply when a draft is replaced.
  perform pg_temp.qa_assert(pg_temp.qa_err(format('select public.replace_quotation_draft(%L, pg_temp.qa_header(%L), %L::jsonb, (select updated_at from public.sales_quotations where id = %L))', v_id, '{"discount":0}',
    '[{"description":"c","quantity":1,"unit":"pax","unit_price":10,"course_id":"40000000-0000-0000-0000-000000000001","course_name_snapshot":"stale"}]', v_id)) = 'P0001|invalid_input:items[1].course_name_snapshot', 'replace enforces the same course rules');
  -- A revision copies the stored snapshots as they are, without re-resolving them against the (possibly changed) profile.
  update public.course_commercial_profiles set standard_display_name = 'Renamed Later', hrdf_display_name = 'Renamed Later (HRDF)' where course_id = '40000000-0000-0000-0000-000000000001';
  update public.sales_quotations set status = 'sent' where id = v_id;
  perform public.create_quotation_revision(v_id, gen_random_uuid());
  perform pg_temp.qa_assert((select count(*) from public.sales_quotation_items i join public.sales_quotations q on q.id = i.quotation_id where q.parent_quotation_id = v_id and i.course_name_snapshot = 'QA Course (HRDF)') = 1, 'revision keeps the original snapshot');
  update public.course_commercial_profiles set standard_display_name = 'QA Course', hrdf_display_name = 'QA Course (HRDF)' where course_id = '40000000-0000-0000-0000-000000000001';
end $$;

-- 5c. Customer fields not supplied fall back to the company, then the opportunity (createQuotation's prefill) --------------------------
do $$
declare
  v_id uuid;
  v_req uuid := gen_random_uuid();
  q record;
  v_item text := '[{"description":"f","quantity":1,"unit":"pax","unit_price":10}]';
  v_base jsonb := '{"currency":"MYR","discount":0,"sst_applicable":false,"sst_rate":0}';
begin
  -- Nothing supplied, opportunity has a company: company first, then opportunity, first non-empty value wins.
  v_id := public.create_quotation_with_items('20000000-0000-0000-0000-000000000015', v_base, v_item::jsonb, v_req);
  select * into q from public.sales_quotations where id = v_id;
  perform pg_temp.qa_assert(q.customer_company_name = 'Fallback Co' and q.customer_contact_name = 'Co PIC' and q.customer_registration_no = 'REG-1', 'company name, contact and registration come from the company');
  perform pg_temp.qa_assert(q.customer_email = 'pic@co.test', 'empty company email is skipped for the PIC email');
  perform pg_temp.qa_assert(q.customer_phone = '011-1111', 'null company phone is skipped for the PIC phone');
  perform pg_temp.qa_assert(q.billing_address = 'Co Address 1' and q.training_service_address is null, 'billing falls back to the address; training address has no fallback');

  -- A field that is supplied wins, even when empty or null; the rest still fall back.
  v_id := public.create_quotation_with_items('20000000-0000-0000-0000-000000000015',
    v_base || '{"customer_company_name":"Typed Co","customer_email":"","customer_phone":null}', v_item::jsonb, gen_random_uuid());
  select * into q from public.sales_quotations where id = v_id;
  perform pg_temp.qa_assert(q.customer_company_name = 'Typed Co' and q.customer_email is null and q.customer_phone is null, 'supplied values are used as sent, empty and null become NULL');
  perform pg_temp.qa_assert(q.customer_contact_name = 'Co PIC' and q.billing_address = 'Co Address 1', 'omitted fields still fall back');
  v_id := public.create_quotation_with_items('20000000-0000-0000-0000-000000000015', v_base || '{"customer_company_name":""}', v_item::jsonb, gen_random_uuid());
  perform pg_temp.qa_assert((select customer_company_name is null from public.sales_quotations where id = v_id), 'an explicitly empty company name is kept empty, not replaced by the fallback');

  -- No company on the opportunity: the opportunity's own contact fields are used.
  v_id := public.create_quotation_with_items('20000000-0000-0000-0000-000000000016', v_base, v_item::jsonb, gen_random_uuid());
  select * into q from public.sales_quotations where id = v_id;
  perform pg_temp.qa_assert(q.customer_company_name = 'Opp Only Co' and q.customer_contact_name = 'Opp Only Person' and q.customer_email = 'only@x.test' and q.customer_phone = '013-3333'
    and q.customer_registration_no is null and q.billing_address is null, 'opportunity fallback without a company');

  -- Omitted versus sent-empty is a different request, so the same key is refused rather than replayed.
  perform pg_temp.qa_assert(pg_temp.qa_err(format('select public.create_quotation_with_items(%L, %L::jsonb, %L::jsonb, %L)', '20000000-0000-0000-0000-000000000015',
    (v_base || '{"customer_company_name":null}')::text, v_item, v_req)) = 'P0001|idempotency_key_reused', 'omitted versus null is a different request');
  perform pg_temp.qa_assert(public.create_quotation_with_items('20000000-0000-0000-0000-000000000015', v_base, v_item::jsonb, v_req) is not null, 'the identical request still replays');
end $$;

-- 6. Opportunity rules ---------------------------------------------------------------------------------------------------------
do $$
declare
  r record;
  v_state text;
begin
  v_state := pg_temp.qa_state();
  for r in select n, stage from (values (5, 'won'), (6, 'lost'), (7, 'cancelled')) as t(n, stage) loop
    perform pg_temp.qa_assert(pg_temp.qa_err(format('select public.create_quotation_with_items(%L, pg_temp.qa_header(), pg_temp.qa_items(), gen_random_uuid())', '20000000-0000-0000-0000-' || lpad(r.n::text, 12, '0'))) = 'P0001|opportunity_resolved', r.stage || ' opportunity is refused');
  end loop;
  perform pg_temp.qa_assert(pg_temp.qa_err('select public.create_quotation_with_items(gen_random_uuid(), pg_temp.qa_header(), pg_temp.qa_items(), gen_random_uuid())') = 'P0001|opportunity_not_found', 'unknown opportunity refused');
  perform pg_temp.qa_assert(pg_temp.qa_state() = v_state, 'refusals wrote nothing');
  -- D8: new, negotiation and archived all become 'quotation' (as createQuotation does today).
  for r in select n from (values (8), (9), (10), (11)) as t(n) loop
    perform public.create_quotation_with_items(('20000000-0000-0000-0000-' || lpad(r.n::text, 12, '0'))::uuid, pg_temp.qa_header(), pg_temp.qa_items(), gen_random_uuid());
    perform pg_temp.qa_assert((select stage from public.sales_opportunities where id = ('20000000-0000-0000-0000-' || lpad(r.n::text, 12, '0'))::uuid) = 'quotation', 'stage becomes quotation for opportunity ' || r.n);
  end loop;
end $$;

-- 7. Failure injection: a late failure rolls back EVERYTHING the call did (header, items, stage, audit, ledger) -----------------
create function pg_temp.qa_fail_item() returns trigger language plpgsql as $$
begin
  if new.description = 'FAIL-ME' then raise exception 'injected_item_failure'; end if;
  return new;
end;
$$;
create function pg_temp.qa_fail_activity() returns trigger language plpgsql as $$
begin
  if new.note like '%FAIL-AUDIT%' then raise exception 'injected_audit_failure'; end if;
  return new;
end;
$$;
create trigger qa_fail_item before insert on public.sales_quotation_items for each row execute function pg_temp.qa_fail_item();
create trigger qa_fail_activity before insert on public.sales_activity for each row execute function pg_temp.qa_fail_activity();

do $$
declare
  v_state text := pg_temp.qa_state();
  v_stage text := (select stage from public.sales_opportunities where id = '20000000-0000-0000-0000-000000000013');
  v_req uuid := gen_random_uuid();
  v_err text;
begin
  v_err := pg_temp.qa_err(format('select public.create_quotation_with_items(%L, pg_temp.qa_header(), %L::jsonb, %L)', '20000000-0000-0000-0000-000000000013',
    '[{"description":"ok","quantity":1,"unit":"pax","unit_price":5},{"description":"FAIL-ME","quantity":1,"unit":"pax","unit_price":5}]', v_req));
  perform pg_temp.qa_assert(v_err = 'P0001|injected_item_failure', 'item failure on the second item surfaces, got ' || v_err);
  perform pg_temp.qa_assert(pg_temp.qa_state() = v_state, 'failed create left no quotation, item, audit or ledger row');
  perform pg_temp.qa_assert((select stage from public.sales_opportunities where id = '20000000-0000-0000-0000-000000000013') = v_stage, 'failed create left the stage unchanged');
  -- The same request id is still usable afterwards: the failed call did not burn it.
  perform public.create_quotation_with_items('20000000-0000-0000-0000-000000000013', pg_temp.qa_header(), pg_temp.qa_items(), v_req);
  perform pg_temp.qa_assert((select count(*) from public.sales_quotation_requests where request_id = v_req) = 1, 'request id reusable after a failed call');
end $$;

-- 8. replace_quotation_draft ----------------------------------------------------------------------------------------------------
do $$
declare
  v_id uuid;
  v_token timestamptz;
  v_new_token timestamptz;
  v_no text;
  v_state text;
begin
  v_id := public.create_quotation_with_items('20000000-0000-0000-0000-000000000014', pg_temp.qa_header(), pg_temp.qa_items(), gen_random_uuid());
  select updated_at, quotation_no into v_token, v_no from public.sales_quotations where id = v_id;

  perform public.replace_quotation_draft(v_id, pg_temp.qa_header('{"notes":"edited","discount":0,"sst_applicable":false}'),
    '[{"description":"Only line","quantity":2,"unit":"day","unit_price":50.5,"discount":1}]', v_token);
  perform pg_temp.qa_assert((select subtotal = 100.00 and total = 100.00 and tax = 0 and notes = 'edited' and status = 'draft' and revision_no = 0 and quotation_no = v_no and opportunity_id = '20000000-0000-0000-0000-000000000014' from public.sales_quotations where id = v_id), 'header replaced, identity fields untouched');
  perform pg_temp.qa_assert((select count(*) from public.sales_quotation_items where quotation_id = v_id) = 1 and (select description from public.sales_quotation_items where quotation_id = v_id) = 'Only line', 'items replaced');
  select updated_at into v_new_token from public.sales_quotations where id = v_id;
  perform pg_temp.qa_assert(v_new_token > v_token, 'version token advances');

  v_state := pg_temp.qa_state();
  perform pg_temp.qa_assert(pg_temp.qa_err(format('select public.replace_quotation_draft(%L, pg_temp.qa_header(), pg_temp.qa_items(), %L)', v_id, v_token)) = 'P0001|quotation_stale', 'old token is stale');
  perform pg_temp.qa_assert(pg_temp.qa_state() = v_state and (select notes from public.sales_quotations where id = v_id) = 'edited', 'stale call changed nothing');
  perform pg_temp.qa_assert(pg_temp.qa_err(format('select public.replace_quotation_draft(%L, pg_temp.qa_header(), pg_temp.qa_items(), null)', v_id)) = 'P0001|invalid_input:request', 'missing token refused');
  perform pg_temp.qa_assert(pg_temp.qa_err('select public.replace_quotation_draft(gen_random_uuid(), pg_temp.qa_header(), pg_temp.qa_items(), now())') = 'P0001|quotation_not_found', 'unknown quotation');
  perform pg_temp.qa_assert(pg_temp.qa_err(format('select public.replace_quotation_draft(%L, pg_temp.qa_header(), ''[]''::jsonb, %L)', v_id, v_new_token)) = 'P0001|invalid_input:items', 'invalid items refused before any write');
  perform pg_temp.qa_assert(pg_temp.qa_state() = v_state, 'invalid replace changed nothing');

  -- Failure while inserting the new items rolls the header and the old items back.
  perform pg_temp.qa_assert(pg_temp.qa_err(format('select public.replace_quotation_draft(%L, pg_temp.qa_header(%L), %L::jsonb, %L)', v_id, '{"notes":"must-not-stick"}',
    '[{"description":"FAIL-ME","quantity":1,"unit":"pax","unit_price":1}]', v_new_token)) like '%|injected_item_failure', 'injected failure surfaces');
  perform pg_temp.qa_assert((select notes from public.sales_quotations where id = v_id) = 'edited' and (select count(*) from public.sales_quotation_items where quotation_id = v_id) = 1
    and (select description from public.sales_quotation_items where quotation_id = v_id) = 'Only line' and (select updated_at from public.sales_quotations where id = v_id) = v_new_token, 'failed replace kept header, items and token');

  -- Not a draft once sent.
  perform public.mark_quotation_sent(v_id);
  perform pg_temp.qa_assert(pg_temp.qa_err(format('select public.replace_quotation_draft(%L, pg_temp.qa_header(), pg_temp.qa_items(), now())', v_id)) = 'P0001|quotation_not_draft', 'sent quotation cannot be replaced');
end $$;

-- 9. mark_quotation_sent ----------------------------------------------------------------------------------------------------------
do $$
declare
  v_id uuid;
  v_state text;
begin
  v_id := public.create_quotation_with_items('20000000-0000-0000-0000-000000000001', pg_temp.qa_header('{"notes":"send me"}'), pg_temp.qa_items(), gen_random_uuid());
  perform public.mark_quotation_sent(v_id);
  perform pg_temp.qa_assert((select status = 'sent' and sent_at is not null from public.sales_quotations where id = v_id), 'sent with timestamp');
  perform pg_temp.qa_assert((select count(*) from public.sales_activity where quotation_id = v_id and type = 'quotation_sent') = 1, 'one sent audit row');
  v_state := pg_temp.qa_state();
  perform pg_temp.qa_assert(pg_temp.qa_err(format('select public.mark_quotation_sent(%L)', v_id)) like 'P0001|invalid_transition%', 'second send refused');
  perform pg_temp.qa_assert(pg_temp.qa_err('select public.mark_quotation_sent(gen_random_uuid())') = 'P0001|quotation_not_found', 'unknown quotation');
  perform pg_temp.qa_assert(pg_temp.qa_state() = v_state, 'refusals wrote nothing');

  -- Audit failure rolls the status change back.
  v_id := public.create_quotation_with_items('20000000-0000-0000-0000-000000000001', pg_temp.qa_header(), pg_temp.qa_items(), gen_random_uuid());
  update public.sales_quotations set quotation_no = quotation_no where id = v_id;
  update public.sales_quotations set quotation_no = 'FAIL-AUDIT-1' where id = v_id;
  perform pg_temp.qa_assert(pg_temp.qa_err(format('select public.mark_quotation_sent(%L)', v_id)) like '%|injected_audit_failure', 'injected audit failure surfaces');
  perform pg_temp.qa_assert((select status from public.sales_quotations where id = v_id) = 'draft' and (select sent_at from public.sales_quotations where id = v_id) is null, 'failed audit rolled the send back');
end $$;

-- 10. create_quotation_revision --------------------------------------------------------------------------------------------------------
do $$
declare
  v_src uuid;
  v_rev uuid;
  v_rev2 uuid;
  v_req uuid := gen_random_uuid();
  v_state text;
  s record;
  r record;
begin
  v_src := public.create_quotation_with_items('20000000-0000-0000-0000-000000000001', pg_temp.qa_header('{"notes":"to be revised"}'), pg_temp.qa_items(), gen_random_uuid());
  -- Give the draft SST snapshots (as a future activation would) so the copy is observable, then send it.
  update public.sales_quotations set tax_label_snapshot = 'SST 8%', tax_basis_snapshot = 'services', sst_registration_number_snapshot = 'W10-0000-00000000', sst_effective_date_snapshot = date '2026-01-01' where id = v_src;
  perform pg_temp.qa_assert(pg_temp.qa_err(format('select public.create_quotation_revision(%L, gen_random_uuid())', v_src)) like 'P0001|invalid_transition%', 'a draft cannot be revised');
  perform public.mark_quotation_sent(v_src);

  v_rev := public.create_quotation_revision(v_src, v_req);
  select * into s from public.sales_quotations where id = v_src;
  select * into r from public.sales_quotations where id = v_rev;
  perform pg_temp.qa_assert(s.status = 'superseded' and s.superseded_at is not null, 'source superseded');
  perform pg_temp.qa_assert(r.status = 'draft' and r.quotation_no = s.quotation_no and r.revision_no = s.revision_no + 1 and r.parent_quotation_id = v_src and r.opportunity_id = s.opportunity_id, 'revision is a draft child with the next number');
  perform pg_temp.qa_assert(r.subtotal = s.subtotal and r.discount = s.discount and r.tax = s.tax and r.total = s.total and r.sst_amount = s.sst_amount and r.sst_applicable = s.sst_applicable and r.sst_rate = s.sst_rate, 'money copied, not recomputed');
  perform pg_temp.qa_assert(r.tax_label_snapshot = 'SST 8%' and r.tax_basis_snapshot = 'services' and r.sst_registration_number_snapshot = 'W10-0000-00000000' and r.sst_effective_date_snapshot = date '2026-01-01', 'all four SST snapshots copied');
  perform pg_temp.qa_assert(r.customer_company_name = s.customer_company_name and r.billing_address = s.billing_address and r.terms = s.terms and r.notes = s.notes and r.valid_until = s.valid_until and r.currency = s.currency and r.created_by = 'aaaaaaaa-0000-0000-0000-000000000001', 'header copied, actor recorded');
  perform pg_temp.qa_assert((select count(*) from public.sales_quotation_items where quotation_id = v_rev) = 2
    and not exists (
      (select description, quantity, unit, unit_price, discount, sort_order, course_id, course_name_snapshot, hrdf_claim, package_includes_snapshot from public.sales_quotation_items where quotation_id = v_src
       except select description, quantity, unit, unit_price, discount, sort_order, course_id, course_name_snapshot, hrdf_claim, package_includes_snapshot from public.sales_quotation_items where quotation_id = v_rev)), 'items copied exactly');
  perform pg_temp.qa_assert((select count(*) from public.sales_activity where quotation_id = v_rev and type = 'quotation_revised') = 1, 'revised audit row');
  perform pg_temp.qa_assert((select quotation_id from public.sales_quotation_requests where request_id = v_req) = v_rev, 'ledger published');

  v_state := pg_temp.qa_state();
  perform pg_temp.qa_assert(public.create_quotation_revision(v_src, v_req) = v_rev, 'replay returns the same revision');
  perform pg_temp.qa_assert(pg_temp.qa_state() = v_state, 'replay wrote nothing');
  perform pg_temp.qa_assert(pg_temp.qa_err(format('select public.create_quotation_revision(%L, gen_random_uuid())', v_src)) like 'P0001|invalid_transition%', 'a second revision of the same source is refused');
  perform pg_temp.qa_assert(pg_temp.qa_err(format('select public.create_quotation_revision(%L, gen_random_uuid())', v_rev)) like 'P0001|invalid_transition%', 'the draft revision itself cannot be revised');
  perform pg_temp.qa_assert(pg_temp.qa_err('select public.create_quotation_revision(gen_random_uuid(), gen_random_uuid())') = 'P0001|quotation_not_found', 'unknown source');
  perform pg_temp.qa_assert(pg_temp.qa_state() = v_state, 'refusals wrote nothing');

  -- Numbering continues the family: send revision 1, revise it -> revision 2.
  perform public.mark_quotation_sent(v_rev);
  v_rev2 := public.create_quotation_revision(v_rev, gen_random_uuid());
  perform pg_temp.qa_assert((select revision_no from public.sales_quotations where id = v_rev2) = s.revision_no + 2, 'next revision number in the family');

  -- Rejected and expired sources are revisable too.
  for r in select x.status from (values ('rejected'), ('expired')) as x(status) loop
    v_src := public.create_quotation_with_items('20000000-0000-0000-0000-000000000001', pg_temp.qa_header(), pg_temp.qa_items(), gen_random_uuid());
    update public.sales_quotations set status = r.status where id = v_src;
    perform public.create_quotation_revision(v_src, gen_random_uuid());
    perform pg_temp.qa_assert((select status from public.sales_quotations where id = v_src) = 'superseded', r.status || ' source is revisable');
  end loop;
end $$;

-- 10a. A family that somehow spans two opportunities is refused rather than half-locked -----------------------------------------------
do $$
declare
  v_src uuid;
  v_no text;
  v_state text;
begin
  v_src := public.create_quotation_with_items('20000000-0000-0000-0000-000000000001', pg_temp.qa_header(), pg_temp.qa_items(), gen_random_uuid());
  update public.sales_quotations set status = 'sent' where id = v_src;
  select quotation_no into v_no from public.sales_quotations where id = v_src;
  insert into public.sales_quotations (opportunity_id, quotation_no, revision_no, status) values ('20000000-0000-0000-0000-000000000002', v_no, 9, 'draft');
  v_state := pg_temp.qa_state();
  perform pg_temp.qa_assert(pg_temp.qa_err(format('select public.create_quotation_revision(%L, gen_random_uuid())', v_src)) = 'P0001|quotation_family_opportunity_mismatch', 'mismatched family refused');
  perform pg_temp.qa_assert(pg_temp.qa_state() = v_state and (select status from public.sales_quotations where id = v_src) = 'sent', 'refusal wrote nothing');
end $$;

-- 10b. Revision failure leaves the source exactly as it was (the case that stranded sources before) ------------------------------------
do $$
declare
  v_src uuid;
  v_state text;
  v_before record;
begin
  v_src := public.create_quotation_with_items('20000000-0000-0000-0000-000000000001', pg_temp.qa_header('{"notes":"FAIL-AUDIT-revise"}'), pg_temp.qa_items(), gen_random_uuid());
  update public.sales_quotations set quotation_no = 'FAIL-AUDIT-2' where id = v_src;
  update public.sales_quotations set status = 'sent' where id = v_src;
  v_state := pg_temp.qa_state();
  select status, superseded_at, updated_at into v_before from public.sales_quotations where id = v_src;
  perform pg_temp.qa_assert(pg_temp.qa_err(format('select public.create_quotation_revision(%L, gen_random_uuid())', v_src)) like '%|injected_audit_failure', 'a failing audit insert surfaces');
  perform pg_temp.qa_assert(pg_temp.qa_state() = v_state, 'no revision, items, audit or ledger row was left behind');
  perform pg_temp.qa_assert((select status = v_before.status and superseded_at is not distinct from v_before.superseded_at and updated_at = v_before.updated_at from public.sales_quotations where id = v_src), 'the source is still sent and untouched');
end $$;

-- 11. Compatibility with the governed flows: accept, then invoice ------------------------------------------------------------------------
do $$
declare
  v_id uuid;
  v_invoice uuid;
  v_total numeric;
begin
  v_id := public.create_quotation_with_items('20000000-0000-0000-0000-000000000001', pg_temp.qa_header('{"notes":"accept me"}'), pg_temp.qa_items(), gen_random_uuid());
  perform public.mark_quotation_sent(v_id);
  perform public.accept_quotation(v_id);
  perform pg_temp.qa_assert((select status from public.sales_quotations where id = v_id) = 'accepted' and (select stage from public.sales_opportunities where id = '20000000-0000-0000-0000-000000000001') = 'won', 'accept_quotation works on an RPC-created quotation');
  perform pg_temp.qa_assert(pg_temp.qa_err(format('select public.create_quotation_revision(%L, gen_random_uuid())', v_id)) like 'P0001|invalid_transition%', 'an accepted quotation cannot be revised');
  perform pg_temp.qa_assert(pg_temp.qa_err('select public.create_quotation_with_items(''20000000-0000-0000-0000-000000000001'', pg_temp.qa_header(), pg_temp.qa_items(), gen_random_uuid())') = 'P0001|opportunity_resolved', 'a won opportunity takes no new quotation');
  select total into v_total from public.sales_quotations where id = v_id;
  v_invoice := public.create_invoice_from_quotation(v_id);
  perform pg_temp.qa_assert((select grand_total = v_total and quotation_id = v_id from public.invoices where id = v_invoice), 'invoice created from the accepted quotation carries its total');
  perform pg_temp.qa_assert((select count(*) from public.invoice_items where invoice_id = v_invoice) = 2, 'invoice items copied');
  perform pg_temp.qa_assert((select hrdf_claim from public.invoice_items where invoice_id = v_invoice and description = 'Line A'), 'HRDF snapshot flows through to the invoice item');
end $$;

-- 12. Real client path: the authenticated role can call the RPC without any table privilege on the ledger ----------------------------------
set local role authenticated;
select pg_temp.qa_as('aaaaaaaa-0000-0000-0000-000000000001');
do $$
declare
  v_id uuid;
begin
  v_id := public.create_quotation_with_items('20000000-0000-0000-0000-000000000011', pg_temp.qa_header(), pg_temp.qa_items(), gen_random_uuid());
  perform pg_temp.qa_assert(v_id is not null, 'authenticated role can create');
  perform pg_temp.qa_assert(pg_temp.qa_err('select count(*) from public.sales_quotation_requests') like '42501|%', 'authenticated role cannot read the ledger');
  perform public.mark_quotation_sent(v_id);
end $$;
reset role;
set local role anon;
do $$
begin
  perform pg_temp.qa_assert(pg_temp.qa_err('select public.mark_quotation_sent(gen_random_uuid())') like '42501|%', 'anon cannot execute');
end $$;
reset role;

-- 13. Certificate isolation: none of the new objects mentions certificates ---------------------------------------------------------------
do $$
begin
  perform pg_temp.qa_assert(not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.proname in ('create_quotation_with_items','replace_quotation_draft','create_quotation_revision','mark_quotation_sent',
      'quotation_input_numeric','quotation_input_text','quotation_normalize_header','quotation_normalize_items','quotation_compute_totals',
      'quotation_request_fingerprint','quotation_reserve_request')
      and p.prosrc ~* 'certificate'), 'no new function references certificates');
  perform pg_temp.qa_assert(not exists (select 1 from information_schema.columns where table_name = 'sales_quotation_requests' and column_name ilike '%certificate%'), 'ledger has no certificate column');
end $$;

rollback;
select 'quotation_atomic_rpcs_behavior_test: PASS' as result;
