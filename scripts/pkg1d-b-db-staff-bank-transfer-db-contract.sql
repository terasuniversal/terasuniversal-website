-- PKG-1d-B-DB-G1 DB contract SQL (synthetic data only; run by scripts/pkg1d-b-db-staff-bank-transfer-db-contract.mts
-- against a disposable local PostgreSQL). The @@helpers section is committed once; @@checks runs inside BEGIN ... ROLLBACK
-- so it can be repeated against mutated migrations. Every check asserts database state, not only JSON results.

-- @@helpers
create schema if not exists dbg1_t;

-- Synthetic staff: two more active admins, an inactive super admin, a trainer and a client (pkg1c_t/pkg1d_t already
-- provide admin a001, editor e001 and inactive admin a002). The ACTIVE synthetic super admin is created only inside the
-- rolled-back @@checks transaction: committed, it would become app.toyyibpay_system_actor() for the earlier contracts.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000b001', 'dbg1-admin2@example.invalid'),
  ('00000000-0000-0000-0000-00000000b002', 'dbg1-admin3@example.invalid'),
  ('00000000-0000-0000-0000-00000000f001', 'dbg1-super@example.invalid'),
  ('00000000-0000-0000-0000-00000000f002', 'dbg1-super-inactive@example.invalid'),
  ('00000000-0000-0000-0000-00000000c701', 'dbg1-trainer@example.invalid'),
  ('00000000-0000-0000-0000-00000000c801', 'dbg1-client@example.invalid')
on conflict do nothing;
insert into public.profiles (id, email, full_name, role, is_active) values
  ('00000000-0000-0000-0000-00000000b001', 'dbg1-admin2@example.invalid', 'SYNTHETIC Admin Two', 'admin', true),
  ('00000000-0000-0000-0000-00000000b002', 'dbg1-admin3@example.invalid', 'SYNTHETIC Admin Three', 'admin', true),
  ('00000000-0000-0000-0000-00000000f002', 'dbg1-super-inactive@example.invalid', 'SYNTHETIC Inactive Super Admin', 'super_admin', false),
  ('00000000-0000-0000-0000-00000000c701', 'dbg1-trainer@example.invalid', 'SYNTHETIC Trainer', 'trainer', true),
  ('00000000-0000-0000-0000-00000000c801', 'dbg1-client@example.invalid', 'SYNTHETIC Client', 'client', true)
on conflict (id) do update set role = excluded.role, is_active = excluded.is_active, email = excluded.email;

-- Synthetic receiving accounts (never real TERAS accounts): A and B active, C inactive.
insert into public.payment_receiving_accounts (id, code, bank_name, account_label, account_last4, reference_scheme, is_active) values
  ('00000000-0000-0000-0000-0000000ac001', 'SYN-A', 'Synthetic Bank', 'Synthetic account A', '0001', 'payer_reference', true),
  ('00000000-0000-0000-0000-0000000ac002', 'SYN-B', 'Synthetic Bank', 'Synthetic account B', '0002', 'payer_reference', true),
  ('00000000-0000-0000-0000-0000000ac003', 'SYN-C', 'Synthetic Bank', 'Synthetic account C (inactive)', '0003', 'payer_reference', false)
on conflict (id) do nothing;

create or replace function dbg1_t.u(p text) returns uuid language sql immutable as $$ select md5(p)::uuid $$;
create or replace function dbg1_t.acct(p_code text) returns uuid language sql as $$ select id from public.payment_receiving_accounts where code = p_code $$;
create or replace function dbg1_t.today() returns date language sql as $$ select (now() at time zone 'Asia/Kuala_Lumpur')::date $$;
create or replace function dbg1_t.ref(p_reg uuid) returns text language sql as $$ select registration_reference from public.public_registrations where id = p_reg $$;

-- The staff bank-transfer RPC as a signed-in user. Amount: the registration snapshot unless p_raw (then p_amount as given).
create or replace function dbg1_t.staffj(p_reg uuid, p_code text, p_ref text, p_req uuid, p_amount numeric default null,
  p_raw boolean default false, p_notes text default 'Penyata bank disemak 2026', p_as uuid default '00000000-0000-0000-0000-00000000a001',
  p_account uuid default null) returns jsonb
language plpgsql as $$
declare v_amount numeric;
begin
  perform pkg1c_t.ctx('authenticated', p_as::text);
  if p_raw then v_amount := p_amount; else select coalesce(p_amount, amount_snapshot) into v_amount from public.public_registrations where id = p_reg; end if;
  return public.verify_public_registration_bank_transfer_by_staff(p_reg, coalesce(p_account, dbg1_t.acct(p_code)), v_amount, p_ref, p_req, p_notes);
exception when others then
  return jsonb_build_object('error', sqlstate || ':' || sqlerrm);
end $$;
create or replace function dbg1_t.staff(p_reg uuid, p_code text, p_ref text, p_req uuid, p_amount numeric default null,
  p_raw boolean default false, p_notes text default 'Penyata bank disemak 2026', p_as uuid default '00000000-0000-0000-0000-00000000a001',
  p_account uuid default null) returns text
language plpgsql as $$
declare r jsonb;
begin
  r := dbg1_t.staffj(p_reg, p_code, p_ref, p_req, p_amount, p_raw, p_notes, p_as, p_account);
  return coalesce('ERR:' || (r->>'error'), (r->>'outcome') || '|' || coalesce(r->>'reason', '-'));
end $$;

create or replace function dbg1_t.claimj(p_reg uuid, p_code text, p_amount numeric, p_ref text, p_req uuid,
  p_notes text default 'Penyata menunjukkan dana tambahan', p_as uuid default '00000000-0000-0000-0000-00000000a001',
  p_on date default null) returns jsonb
language plpgsql as $$
begin
  perform pkg1c_t.ctx('authenticated', p_as::text);
  return public.record_public_registration_additional_funds_claim(p_reg, dbg1_t.acct(p_code), p_amount, coalesce(p_on, dbg1_t.today()), p_ref, p_req, p_notes);
exception when others then
  return jsonb_build_object('error', sqlstate || ':' || sqlerrm);
end $$;
create or replace function dbg1_t.claim(p_reg uuid, p_code text, p_amount numeric, p_ref text, p_req uuid,
  p_notes text default 'Penyata menunjukkan dana tambahan', p_as uuid default '00000000-0000-0000-0000-00000000a001',
  p_on date default null) returns text
language plpgsql as $$
declare r jsonb;
begin
  r := dbg1_t.claimj(p_reg, p_code, p_amount, p_ref, p_req, p_notes, p_as, p_on);
  return coalesce('ERR:' || (r->>'error'), r->>'outcome');
end $$;
create or replace function dbg1_t.decide(p_af uuid, p_decision text, p_req uuid, p_notes text default 'Disemak dengan penyata bank',
  p_as uuid default '00000000-0000-0000-0000-00000000b001') returns text
language plpgsql as $$
declare r jsonb;
begin
  perform pkg1c_t.ctx('authenticated', p_as::text);
  r := public.decide_public_registration_additional_funds(p_af, p_decision, p_req, p_notes);
  return r->>'outcome';
exception when others then
  return 'ERR:' || sqlstate || ':' || sqlerrm;
end $$;

create or replace function dbg1_t.pays(p_reg uuid, p_provider text default null, p_status text default null) returns integer
language sql as $$ select count(*)::integer from public.public_registration_payments where registration_id = p_reg
  and (p_provider is null or payment_provider = p_provider) and (p_status is null or status = p_status) $$;
create or replace function dbg1_t.afs(p_reg uuid, p_status text default null) returns integer
language sql as $$ select count(*)::integer from public.public_registration_additional_funds where registration_id = p_reg
  and (p_status is null or status = p_status) $$;
create or replace function dbg1_t.bank_id(p_reg uuid) returns uuid
language sql as $$ select id from public.public_registration_payments where registration_id = p_reg and payment_provider = 'bank_transfer'
  order by created_at desc, id limit 1 $$;
create or replace function dbg1_t.tp_id(p_reg uuid) returns uuid
language sql as $$ select id from public.public_registration_payments where registration_id = p_reg and payment_provider = 'toyyibpay'
  order by created_at, id limit 1 $$;
create or replace function dbg1_t.ev(p_entity uuid, p_event text) returns integer
language sql as $$ select count(*)::integer from public.audit_logs where entity_id = p_entity::text and metadata->>'event' = p_event $$;
create or replace function dbg1_t.ev_ref(p_reference text, p_event text) returns integer
language sql as $$ select count(*)::integer from public.audit_logs where metadata->>'registration_reference' = p_reference and metadata->>'event' = p_event $$;
-- All semantic events (metadata.event) of one registration; row-audit trigger entries are not counted.
create or replace function dbg1_t.ev_all(p_reference text) returns integer
language sql as $$ select count(*)::integer from public.audit_logs where metadata->>'registration_reference' = p_reference and metadata ? 'event' $$;
create or replace function dbg1_t.af_id(p_req uuid) returns uuid
language sql as $$ select id from public.public_registration_additional_funds where claim_request_id = p_req $$;
-- A begin without attach: the attempt is 'pending' with bill_creation_state 'claimed' (bill being created).
create or replace function dbg1_t.claim_bill(p_reg uuid, p_key text) returns uuid
language plpgsql as $$
begin
  perform pkg1c_t.ctx('service_role');
  perform public.begin_public_registration_payment((select registration_reference from public.public_registrations where id = p_reg), pkg1c_t.secret(p_key));
  return (select id from public.public_registration_payments where registration_id = p_reg and payment_provider = 'toyyibpay' order by created_at desc limit 1);
end $$;
create or replace function dbg1_t.attach(p_attempt uuid, p_key text) returns text
language plpgsql as $$
begin
  perform pkg1c_t.ctx('service_role');
  return (public.attach_public_registration_toyy_pay_bill(p_attempt, 'BILL-' || p_key, 'https://example.invalid/pay/' || p_key))->>'status';
exception when others then
  return 'ERR:' || sqlerrm;
end $$;
-- An SQL statement executed as a given database role (for ACL / RLS / direct-write checks).
create or replace function dbg1_t.as_role(p_role text, p_sub text, p_sql text) returns text
language plpgsql as $$
declare n integer;
begin
  perform pkg1c_t.ctx(case when p_role in ('anon', 'service_role') then p_role else 'authenticated' end, coalesce(p_sub, ''));
  execute format('set local role %I', p_role);
  execute p_sql;
  get diagnostics n = row_count;
  reset role;
  return 'OK:' || n;
exception when others then
  reset role;
  return 'ERR:' || sqlstate || ':' || sqlerrm;
end $$;
create or replace function dbg1_t.count_as(p_role text, p_sub text, p_table text) returns text
language plpgsql as $$
declare n integer;
begin
  perform pkg1c_t.ctx('authenticated', coalesce(p_sub, ''));
  execute format('set local role %I', p_role);
  execute format('select count(*) from %s', p_table) into n;
  reset role;
  return n::text;
exception when others then
  reset role;
  return 'ERR:' || sqlstate;
end $$;

-- @@checks
insert into public.profiles (id, email, full_name, role, is_active) values
  ('00000000-0000-0000-0000-00000000f001', 'dbg1-super@example.invalid', 'SYNTHETIC Super Admin', 'super_admin', true)
on conflict (id) do update set role = 'super_admin', is_active = true;
create temp table t_results (ord serial, name text, ok boolean, detail text);
create function pg_temp.chk(p_name text, p_ok boolean, p_detail text default '') returns void
language sql as $$ insert into t_results (name, ok, detail) values (p_name, coalesce(p_ok, false), coalesce(p_detail, '')) $$;

-- S1: normal staff verification, active admin and active super admin.
do $$ declare s uuid; r uuid; j jsonb; b uuid; begin
  s := pkg1c_t.schedule('s1', 5); r := pkg1c_t.reg(s, 's1');
  j := dbg1_t.staffj(r, 'SYN-A', '  BANK   S1 001 ', dbg1_t.u('s1'));
  perform pg_temp.chk('S1 admin aktif, akaun A: confirmed', j->>'outcome' = 'confirmed', j::text);
  b := dbg1_t.bank_id(r);
  perform pg_temp.chk('S1 tepat 1 rekod bank paid: akaun A, staff_request_id, amaun = snapshot, rujukan dirapikan, saluran staff',
    dbg1_t.pays(r) = 1 and exists (select 1 from public.public_registration_payments where id = b and status = 'paid'
      and receiving_account_id = dbg1_t.acct('SYN-A') and staff_request_id = dbg1_t.u('s1') and amount = 100 and verified_amount = 100
      and verified_at is not null and provider_reference = 'BANK S1 001' and raw_response->>'channel' = 'staff'
      and raw_response->>'verified_by' = '00000000-0000-0000-0000-00000000a001' and raw_response->>'notes' = 'Penyata bank disemak 2026'),
    (select row_to_json(p)::text from public.public_registration_payments p where id = b));
  perform pg_temp.chk('S1 pendaftaran confirmed/paid/nohold; 1 kerusi; peserta didaftarkan',
    pkg1c_t.state(r) = 'confirmed/paid/nohold' and pkg1c_t.taken(s) = 1 and pkg1c_t.enrolled(s) = 1 and pkg1c_t.reg_enrolled(r) = 1, pkg1c_t.state(r));
  perform pg_temp.chk('S1 tepat 1 acara manual_payment_recorded (actor pengesah, saluran staff, kod akaun); tiada supersede',
    dbg1_t.ev(b, 'manual_payment_recorded') = 1 and exists (select 1 from public.audit_logs where entity_id = b::text
      and metadata->>'event' = 'manual_payment_recorded' and actor_id = '00000000-0000-0000-0000-00000000a001'
      and metadata->>'channel' = 'staff' and metadata->>'receiving_account_code' = 'SYN-A' and metadata->>'request_id' = dbg1_t.u('s1')::text)
      and dbg1_t.ev_ref(dbg1_t.ref(r), 'toyyibpay_attempt_superseded') = 0);
  perform pg_temp.chk('S1 tiada rekod dana tambahan', dbg1_t.afs(r) = 0);
  s := pkg1c_t.schedule('s1b', 5); r := pkg1c_t.reg(s, 's1b');
  perform pg_temp.chk('S1 super_admin aktif: confirmed',
    dbg1_t.staff(r, 'SYN-B', 'BANK S1 002', dbg1_t.u('s1b'), p_as => '00000000-0000-0000-0000-00000000f001') = 'confirmed|-');
end $$;

-- S2: multiple receiving accounts; inactive and unknown accounts.
do $$ declare s uuid; r1 uuid; r2 uuid; r3 uuid; o text; begin
  s := pkg1c_t.schedule('s2', 5);
  r1 := pkg1c_t.reg(s, 's2a'); r2 := pkg1c_t.reg(s, 's2b'); r3 := pkg1c_t.reg(s, 's2c');
  perform pg_temp.chk('S2 rujukan sama pada akaun A dan B: kedua-dua confirmed',
    dbg1_t.staff(r1, 'SYN-A', 'SAME-REF-1', dbg1_t.u('s2a')) = 'confirmed|-' and dbg1_t.staff(r2, 'SYN-B', 'SAME-REF-1', dbg1_t.u('s2b')) = 'confirmed|-');
  perform pg_temp.chk('S2 akaun berbeza: tiada bendera kemungkinan pendua',
    (select raw_response->'possible_duplicate_reference' from public.public_registration_payments where id = dbg1_t.bank_id(r2)) = 'null'::jsonb
    and dbg1_t.ev_ref(dbg1_t.ref(r2), 'manual_payment_recorded') = 1
    and (select metadata->>'possible_duplicate_reference' from public.audit_logs where entity_id = dbg1_t.bank_id(r2)::text and metadata->>'event' = 'manual_payment_recorded') = 'false');
  o := dbg1_t.staff(r3, 'SYN-C', 'BANK S2 C', dbg1_t.u('s2c'));
  perform pg_temp.chk('S2 akaun C tidak aktif: invalid_receiving_account, 0 rekod', o like 'ERR:P0001:invalid_receiving_account%' and dbg1_t.pays(r3) = 0, o);
  o := dbg1_t.staff(r3, null, 'BANK S2 X', dbg1_t.u('s2x'), p_account => gen_random_uuid());
  perform pg_temp.chk('S2 akaun tidak wujud: invalid_receiving_account, 0 rekod', o like 'ERR:P0001:invalid_receiving_account%' and dbg1_t.pays(r3) = 0, o);
  perform pg_temp.chk('S2 akaun C kekal tidak aktif dan tidak berubah', not (select is_active from public.payment_receiving_accounts where code = 'SYN-C'));
end $$;

-- S3: a reference already used on the same receiving account (differs only in case/whitespace): flagged, never rejected.
do $$ declare s uuid; r1 uuid; r2 uuid; j jsonb; b1 uuid; begin
  s := pkg1c_t.schedule('s3', 5);
  r1 := pkg1c_t.reg(s, 's3a'); r2 := pkg1c_t.reg(s, 's3b');
  perform dbg1_t.staff(r1, 'SYN-A', 'DUP 001', dbg1_t.u('s3a'));
  b1 := dbg1_t.bank_id(r1);
  j := dbg1_t.staffj(r2, 'SYN-A', 'dup001', dbg1_t.u('s3b'));
  perform pg_temp.chk('S3 rujukan bertembung (huruf/ruang berbeza), akaun sama: tetap direkod (confirmed), tidak ditolak', j->>'outcome' = 'confirmed', j::text);
  perform pg_temp.chk('S3 rekod kedua dibendera possible_duplicate_reference = [rekod pertama]; satu rekod setiap pendaftaran',
    (select raw_response->'possible_duplicate_reference' from public.public_registration_payments where id = dbg1_t.bank_id(r2)) = jsonb_build_array(b1)
    and dbg1_t.pays(r1) = 1 and dbg1_t.pays(r2) = 1);
  perform pg_temp.chk('S3 acara manual_payment_recorded membawa possible_duplicate_reference = true (satu acara, bukan dua)',
    (select metadata->>'possible_duplicate_reference' from public.audit_logs where entity_id = dbg1_t.bank_id(r2)::text and metadata->>'event' = 'manual_payment_recorded') = 'true'
    and dbg1_t.ev_all(dbg1_t.ref(r2)) = 1);
end $$;

-- S4: amount validation (exact snapshot only).
do $$ declare s uuid; r uuid; o text; v numeric; begin
  s := pkg1c_t.schedule('s4', 5); r := pkg1c_t.reg(s, 's4');
  o := dbg1_t.staff(r, 'SYN-A', 'BANK S4', dbg1_t.u('s4-1'), 99.99, true);
  perform pg_temp.chk('S4 amaun 99.99 (bukan snapshot): manual_payment_amount_mismatch', o like 'ERR:P0001:manual_payment_amount_mismatch%', o);
  foreach v in array array[0, -5, 100.001]::numeric[] loop
    o := dbg1_t.staff(r, 'SYN-A', 'BANK S4', dbg1_t.u('s4-' || v::text), v, true);
    perform pg_temp.chk('S4 amaun ' || v::text || ': invalid_manual_payment', o like 'ERR:P0001:invalid_manual_payment%', o);
  end loop;
  o := dbg1_t.staff(r, 'SYN-A', 'BANK S4', dbg1_t.u('s4-null'), null, true);
  perform pg_temp.chk('S4 amaun NULL: invalid_manual_payment', o like 'ERR:P0001:invalid_manual_payment%', o);
  perform pg_temp.chk('S4 tiada rekod, tiada acara, pendaftaran tidak berubah',
    dbg1_t.pays(r) = 0 and dbg1_t.ev_all(dbg1_t.ref(r)) = 0 and pkg1c_t.state(r) = 'pending_payment/pending/hold');
  perform pg_temp.chk('S4 amaun tepat 100.00: confirmed', dbg1_t.staff(r, 'SYN-A', 'BANK S4', dbg1_t.u('s4-ok'), 100.00, true) = 'confirmed|-');
end $$;

-- S5: mandatory notes (at least five letters or digits after trimming, at most 500 characters); reference format.
do $$ declare s uuid; r uuid; o text; n text; i integer := 0; begin
  s := pkg1c_t.schedule('s5', 5); r := pkg1c_t.reg(s, 's5');
  foreach n in array array['', '    ', '....!', 'ab 12', repeat('a', 501)] loop
    i := i + 1;
    o := dbg1_t.staff(r, 'SYN-A', 'BANK S5', dbg1_t.u('s5-' || i), p_notes => n);
    perform pg_temp.chk('S5 nota tidak sah #' || i || ': invalid_manual_payment_notes', o like 'ERR:P0001:invalid_manual_payment_notes%', o);
  end loop;
  o := dbg1_t.staff(r, 'SYN-A', 'BANK S5', dbg1_t.u('s5-null'), p_notes => null);
  perform pg_temp.chk('S5 nota NULL: invalid_manual_payment_notes', o like 'ERR:P0001:invalid_manual_payment_notes%', o);
  foreach n in array array['', 'ab', repeat('R', 65), 'BAD;REF', '-ABC'] loop
    i := i + 1;
    o := dbg1_t.staff(r, 'SYN-A', n, dbg1_t.u('s5-' || i));
    perform pg_temp.chk('S5 rujukan tidak sah ' || quote_literal(left(n, 12)) || ': invalid_manual_payment', o like 'ERR:P0001:invalid_manual_payment%', o);
  end loop;
  perform pg_temp.chk('S5 tiada rekod daripada input yang ditolak', dbg1_t.pays(r) = 0 and dbg1_t.ev_all(dbg1_t.ref(r)) = 0);
  perform pg_temp.chk('S5 nota tepat 5 alfanumerik ("abc12"): confirmed', dbg1_t.staff(r, 'SYN-A', 'BANK S5', dbg1_t.u('s5-ok'), p_notes => ' abc12 ') = 'confirmed|-');
end $$;

-- S6: only ACTIVE admin / super admin may verify.
do $$ declare s uuid; r uuid; o text; who uuid; begin
  s := pkg1c_t.schedule('s6', 5); r := pkg1c_t.reg(s, 's6');
  foreach who in array array['00000000-0000-0000-0000-00000000a002', '00000000-0000-0000-0000-00000000f002', '00000000-0000-0000-0000-00000000e001',
    '00000000-0000-0000-0000-00000000c701', '00000000-0000-0000-0000-00000000c801', '00000000-0000-0000-0000-0000000dead1']::uuid[] loop
    o := dbg1_t.staff(r, 'SYN-A', 'BANK S6', dbg1_t.u('s6-' || who::text), p_as => who);
    perform pg_temp.chk('S6 ' || right(who::text, 5) || ' (tidak aktif / bukan admin / tiada profil): 42501 not_authorized', o like 'ERR:42501:not_authorized%', o);
  end loop;
  perform pg_temp.chk('S6 tiada rekod dan tiada acara daripada panggilan yang ditolak', dbg1_t.pays(r) = 0 and dbg1_t.ev_all(dbg1_t.ref(r)) = 0);
end $$;

-- S7: ACL, owner, SECURITY DEFINER, search_path; table privileges and RLS.
do $$ declare fn text; o text; begin
  foreach fn in array array['public.verify_public_registration_bank_transfer_by_staff(uuid,uuid,numeric,text,uuid,text)',
    'public.record_public_registration_additional_funds_claim(uuid,uuid,numeric,date,text,uuid,text)',
    'public.decide_public_registration_additional_funds(uuid,text,uuid,text)'] loop
    perform pg_temp.chk('S7 ' || split_part(fn, '(', 1) || ': EXECUTE authenticated sahaja; pemilik postgres; SECURITY DEFINER',
      (select proacl::text from pg_proc where oid = fn::regprocedure) = '{postgres=X/postgres,authenticated=X/postgres}'
      and not has_function_privilege('anon', fn, 'EXECUTE') and not has_function_privilege('service_role', fn, 'EXECUTE')
      and has_function_privilege('authenticated', fn, 'EXECUTE')
      and (select proowner::regrole::text from pg_proc where oid = fn::regprocedure) = 'postgres'
      and (select prosecdef from pg_proc where oid = fn::regprocedure),
      (select proacl::text from pg_proc where oid = fn::regprocedure));
  end loop;
  perform pg_temp.chk('S7 search_path tepat (staf: pg_catalog, public, app, extensions; dana tambahan: pg_catalog, public, app)',
    (select proconfig from pg_proc where oid = 'public.verify_public_registration_bank_transfer_by_staff(uuid,uuid,numeric,text,uuid,text)'::regprocedure) = array['search_path=pg_catalog, public, app, extensions']
    and (select proconfig from pg_proc where oid = 'public.record_public_registration_additional_funds_claim(uuid,uuid,numeric,date,text,uuid,text)'::regprocedure) = array['search_path=pg_catalog, public, app']
    and (select proconfig from pg_proc where oid = 'public.decide_public_registration_additional_funds(uuid,text,uuid,text)'::regprocedure) = array['search_path=pg_catalog, public, app']);
  o := dbg1_t.as_role('anon', null, $q$select public.verify_public_registration_bank_transfer_by_staff(gen_random_uuid(), gen_random_uuid(), 1, 'ABC', gen_random_uuid(), 'abcde')$q$);
  perform pg_temp.chk('S7 anon memanggil RPC staf: 42501', o like 'ERR:42501:%', o);
  o := dbg1_t.as_role('service_role', null, $q$select public.record_public_registration_additional_funds_claim(gen_random_uuid(), gen_random_uuid(), 1, current_date, 'ABC', gen_random_uuid(), 'abcde')$q$);
  perform pg_temp.chk('S7 service_role memanggil RPC tuntutan: 42501', o like 'ERR:42501:%', o);
  perform pg_temp.chk('S7 jadual akaun penerima dan dana tambahan: RLS aktif; anon tiada akses; tiada INSERT/UPDATE/DELETE klien',
    (select relrowsecurity from pg_class where oid = 'public.payment_receiving_accounts'::regclass)
    and (select relrowsecurity from pg_class where oid = 'public.public_registration_additional_funds'::regclass)
    and not has_table_privilege('anon', 'public.payment_receiving_accounts', 'SELECT')
    and not has_table_privilege('anon', 'public.public_registration_additional_funds', 'SELECT')
    and not has_table_privilege('authenticated', 'public.public_registration_additional_funds', 'INSERT')
    and not has_table_privilege('authenticated', 'public.public_registration_additional_funds', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.public_registration_additional_funds', 'DELETE')
    and not has_table_privilege('service_role', 'public.public_registration_additional_funds', 'INSERT')
    and not has_table_privilege('authenticated', 'public.payment_receiving_accounts', 'INSERT'));
  perform pg_temp.chk('S7 RLS: admin aktif nampak akaun penerima (3); editor 0; admin tidak aktif 0',
    dbg1_t.count_as('authenticated', '00000000-0000-0000-0000-00000000a001', 'public.payment_receiving_accounts') = '3'
    and dbg1_t.count_as('authenticated', '00000000-0000-0000-0000-00000000e001', 'public.payment_receiving_accounts') = '0'
    and dbg1_t.count_as('authenticated', '00000000-0000-0000-0000-00000000a002', 'public.payment_receiving_accounts') = '0');
  perform pg_temp.chk('S7 tiada lajur nombor akaun penuh dalam registri',
    not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'payment_receiving_accounts'
      and column_name ~ '(account_no|account_number|iban)'));
end $$;

-- S8: already-paid registrations: no second registration payment, no confirmation, no seat; explicit review outcome.
do $$ declare s uuid; r uuid; j jsonb; o text; n_before integer; ev_before integer; begin
  -- (a) ToyyibPay first, then staff.
  s := pkg1c_t.schedule('s8', 5); r := pkg1c_t.reg(s, 's8a');
  perform pkg1c_t.bill(r, 's8a');
  perform pg_temp.chk('S8 persediaan: ToyyibPay berjaya dahulu (confirmed)', pkg1c_t.cb('s8a') = 'confirmed');
  n_before := dbg1_t.pays(r); ev_before := dbg1_t.ev_all(dbg1_t.ref(r));
  j := dbg1_t.staffj(r, 'SYN-A', 'BANK S8A', dbg1_t.u('s8a'));
  perform pg_temp.chk('S8 ToyyibPay dahulu, staf kemudian: additional_funds_review / registration_already_paid, recorded=false, next_action dana tambahan',
    j->>'outcome' = 'additional_funds_review' and j->>'reason' = 'registration_already_paid' and j->>'recorded' = 'false'
    and j->>'next_action' = 'record_additional_funds_claim' and j->'existing_paid_payment_ids' = jsonb_build_array(dbg1_t.tp_id(r)), j::text);
  perform pg_temp.chk('S8 tiada tulisan: bayaran Δ0, dana tambahan Δ0, acara Δ0; pendaftaran, kerusi dan rekod ToyyibPay tidak berubah',
    dbg1_t.pays(r) = n_before and dbg1_t.pays(r, 'bank_transfer') = 0 and dbg1_t.afs(r) = 0 and dbg1_t.ev_all(dbg1_t.ref(r)) = ev_before
    and pkg1c_t.state(r) = 'confirmed/paid/nohold' and pkg1c_t.enrolled(s) = 1 and pkg1d_t.att(dbg1_t.tp_id(r)) = 'paid/TXN-s8a/100.00');
  -- (b) bank first (staff), then another staff request.
  r := pkg1c_t.reg(s, 's8b');
  perform dbg1_t.staff(r, 'SYN-A', 'BANK S8B', dbg1_t.u('s8b'));
  o := dbg1_t.staff(r, 'SYN-B', 'BANK S8B2', dbg1_t.u('s8b2'), p_as => '00000000-0000-0000-0000-00000000b001');
  perform pg_temp.chk('S8 bank dahulu, permintaan staf kedua (UUID baharu): additional_funds_review, masih 1 rekod bank', o = 'additional_funds_review|registration_already_paid'
    and dbg1_t.pays(r) = 1 and pkg1c_t.enrolled(s) = 2, o);
  o := dbg1_t.staff(r, 'SYN-A', 'BANK S8B', dbg1_t.u('s8b'));
  perform pg_temp.chk('S8 ulangan UUID asal selepas dibayar: already_recorded (idempotensi didahulukan)', o = 'already_recorded|-' and dbg1_t.pays(r) = 1, o);
  -- (c) a refunded payment record also blocks a second registration payment.
  r := pkg1c_t.reg(s, 's8c');
  perform pkg1c_t.bill(r, 's8c'); perform pkg1c_t.cb('s8c');
  update public.public_registration_payments set status = 'refunded' where id = dbg1_t.tp_id(r);
  update public.public_registrations set payment_status = 'refunded' where id = r;
  o := dbg1_t.staff(r, 'SYN-A', 'BANK S8C', dbg1_t.u('s8c'));
  perform pg_temp.chk('S8 rekod refunded wujud: additional_funds_review, tiada rekod bank', o = 'additional_funds_review|registration_already_paid'
    and dbg1_t.pays(r, 'bank_transfer') = 0, o);
end $$;

-- S8L (M0, legacy RPC): R2 closed, replay preserved, open ToyyibPay attempt superseded.
do $$ declare s uuid; r uuid; o text; n integer; begin
  s := pkg1c_t.schedule('s8l', 5); r := pkg1c_t.reg(s, 's8l1');
  perform pkg1c_t.bill(r, 's8l1'); perform pkg1c_t.cb('s8l1');
  n := dbg1_t.pays(r);
  o := pkg1d_t.manual_as(r, 's8l1', '00000000-0000-0000-0000-00000000a001');
  perform pg_temp.chk('S8L M0: RPC lama pada pendaftaran sudah dibayar ToyyibPay: registration_already_paid, tiada rekod kedua (R2 ditutup)',
    o like 'ERR:P0001:registration_already_paid%' and dbg1_t.pays(r) = n and dbg1_t.pays(r, 'bank_transfer') = 0, o);
  r := pkg1c_t.reg(s, 's8l2');
  perform pg_temp.chk('S8L M0: RPC lama biasa kekal confirmed', pkg1d_t.manual_as(r, 's8l2', '00000000-0000-0000-0000-00000000a001') = 'confirmed');
  o := pkg1d_t.manual_as(r, 's8l2', '00000000-0000-0000-0000-00000000a001');
  perform pg_temp.chk('S8L M0: ulangan RPC lama kekal already_paid, satu rekod bank', o = 'already_paid' and dbg1_t.pays(r, 'bank_transfer') = 1, o);
  r := pkg1c_t.reg(s, 's8l3');
  perform pkg1c_t.bill(r, 's8l3');
  o := pkg1d_t.manual_as(r, 's8l3', '00000000-0000-0000-0000-00000000a001');
  perform pg_temp.chk('S8L M0: RPC lama dengan bil ToyyibPay terbuka: confirmed, percubaan ToyyibPay disupersede (bukan pembatalan penyedia), 1 acara',
    o = 'confirmed' and pkg1d_t.att(dbg1_t.tp_id(r)) = 'cancelled/-/-'
    and (select raw_response->'superseded_by_bank_transfer'->>'provider_cancellation_confirmed' from public.public_registration_payments where id = dbg1_t.tp_id(r)) = 'false'
    and dbg1_t.ev(dbg1_t.tp_id(r), 'toyyibpay_attempt_superseded') = 1, o);
  o := pkg1c_t.cb('s8l3');
  perform pg_temp.chk('S8L M0: callback lewat selepas supersede: dicatat sebagai late success, tiada kerusi tambahan',
    o = 'reconciliation_required' and pkg1d_t.att(dbg1_t.tp_id(r)) = 'paid/TXN-s8l3/100.00' and pkg1c_t.reg_enrolled(r) = 1
    and dbg1_t.ev(dbg1_t.tp_id(r), 'late_success_recorded') = 1, o);
end $$;

-- S9: R1 non-finalizable schedules (the A5 block): payment kept, no seat, one R1 event.
do $$ declare s uuid; r uuid; j jsonb; st text; b uuid; begin
  foreach st in array array['cancelled', 'completed'] loop
    s := pkg1c_t.schedule('s9' || left(st, 2), 5); r := pkg1c_t.reg(s, 's9' || left(st, 2));
    update public.course_schedules set status = st::public.schedule_status where id = s;
    j := dbg1_t.staffj(r, 'SYN-A', 'BANK S9 ' || st, dbg1_t.u('s9' || st));
    b := dbg1_t.bank_id(r);
    perform pg_temp.chk('S9 jadual ' || st || ': reconciliation_required / schedule_not_finalizable', j->>'outcome' = 'reconciliation_required'
      and j->>'reason' = 'schedule_not_finalizable', j::text);
    perform pg_temp.chk('S9 jadual ' || st || ': rekod bank paid KEKAL, hold null, 0 kerusi, bukti schedule_status',
      pkg1d_t.att(b) = 'paid/-/100.00' and pkg1c_t.state(r) = 'pending_payment/paid/nohold' and pkg1c_t.enrolled(s) = 0
      and (select raw_response->'schedule_not_finalizable'->>'schedule_status' from public.public_registration_payments where id = b) = st,
      pkg1c_t.state(r) || ' ' || pkg1d_t.att(b));
    perform pg_temp.chk('S9 jadual ' || st || ': tepat 1 acara R1 + 1 manual_payment_recorded; status jadual tidak berubah',
      dbg1_t.ev(b, 'schedule_not_finalizable_recorded') = 1 and dbg1_t.ev(b, 'manual_payment_recorded') = 1
      and (select status::text from public.course_schedules where id = s) = st);
  end loop;
end $$;

-- S5b: ended registrations (expired, cancelled): payment recorded, no seat.
do $$ declare s uuid; r uuid; o text; begin
  s := pkg1c_t.schedule('s5e', 5); r := pkg1c_t.reg(s, 's5e');
  perform pkg1c_t.expire_hold(r); perform pkg1c_t.ctx('service_role'); perform public.expire_public_registrations();
  o := dbg1_t.staff(r, 'SYN-A', 'BANK S5E', dbg1_t.u('s5e'));
  perform pg_temp.chk('S5b pendaftaran expired: reconciliation_required / registration_ended; rekod bank paid; 0 kerusi',
    o = 'reconciliation_required|registration_ended' and pkg1d_t.att(dbg1_t.bank_id(r)) = 'paid/-/100.00' and pkg1c_t.enrolled(s) = 0
    and pkg1c_t.state(r) like 'expired/paid/%', o || ' ' || pkg1c_t.state(r));
  r := pkg1c_t.reg(s, 's5c');
  update public.public_registrations set registration_status = 'cancelled' where id = r;
  o := dbg1_t.staff(r, 'SYN-A', 'BANK S5C', dbg1_t.u('s5c'));
  perform pg_temp.chk('S5b pendaftaran cancelled: reconciliation_required / registration_ended; 0 kerusi', o = 'reconciliation_required|registration_ended'
    and pkg1c_t.enrolled(s) = 0, o);
end $$;

-- S3b: full capacity -> paid_unallocated.
do $$ declare s uuid; r1 uuid; r2 uuid; o text; begin
  s := pkg1c_t.schedule('s3c', 1);
  r1 := pkg1c_t.reg(s, 's3c1'); perform pkg1c_t.expire_hold(r1);
  r2 := pkg1c_t.reg(s, 's3c2');
  perform pg_temp.chk('S3b persediaan: pendaftaran kedua mengambil kerusi terakhir', dbg1_t.staff(r2, 'SYN-A', 'BANK S3C2', dbg1_t.u('s3c2')) = 'confirmed|-');
  o := dbg1_t.staff(r1, 'SYN-A', 'BANK S3C1', dbg1_t.u('s3c1'));
  perform pg_temp.chk('S3b kapasiti penuh: paid_unallocated; rekod bank paid; kerusi = kapasiti 1', o = 'paid_unallocated|-'
    and pkg1d_t.att(dbg1_t.bank_id(r1)) = 'paid/-/100.00' and pkg1c_t.taken(s) = 1 and pkg1c_t.enrolled(s) = 1 and pkg1c_t.reg_enrolled(r1) = 0, o);
end $$;

-- S10: ToyyibPay lifecycle around a staff bank verification.
do $$ declare s uuid; r uuid; o text; tp uuid; att uuid; begin
  -- (a) open bill -> staff -> provider success later.
  s := pkg1c_t.schedule('s10', 5); r := pkg1c_t.reg(s, 's10a');
  tp := pkg1c_t.bill(r, 's10a');
  o := dbg1_t.staff(r, 'SYN-A', 'BANK S10A', dbg1_t.u('s10a'));
  perform pg_temp.chk('S10a bil ToyyibPay terbuka, staf mengesahkan: confirmed; percubaan ToyyibPay disupersede secara dalaman',
    o = 'confirmed|-' and pkg1d_t.att(tp) = 'cancelled/-/-'
    and (select raw_response->'superseded_by_bank_transfer'->>'provider_cancellation_confirmed' from public.public_registration_payments where id = tp) = 'false'
    and (select raw_response->'superseded_by_bank_transfer'->>'bank_payment_id' from public.public_registration_payments where id = tp) = dbg1_t.bank_id(r)::text, o);
  perform pg_temp.chk('S10a tepat 1 acara toyyibpay_attempt_superseded (provider_cancellation_confirmed = false)',
    dbg1_t.ev(tp, 'toyyibpay_attempt_superseded') = 1 and (select metadata->>'provider_cancellation_confirmed' from public.audit_logs
      where entity_id = tp::text and metadata->>'event' = 'toyyibpay_attempt_superseded') = 'false');
  o := pkg1c_t.cb('s10a');
  perform pg_temp.chk('S10a callback berjaya selepas supersede: reconciliation_required (late success); bukti penyedia disimpan',
    o = 'reconciliation_required' and pkg1d_t.att(tp) = 'paid/TXN-s10a/100.00'
    and (select (raw_response->>'late_success_reconciliation_required')::boolean and raw_response ? 'superseded_by_bank_transfer' from public.public_registration_payments where id = tp), o);
  perform pg_temp.chk('S10a dua rekod wang paid kekal (bank + ToyyibPay); pendaftaran confirmed; TIADA kerusi tambahan; 1 acara late_success_recorded',
    dbg1_t.pays(r, null, 'paid') = 2 and pkg1c_t.state(r) = 'confirmed/paid/nohold' and pkg1c_t.reg_enrolled(r) = 1 and pkg1c_t.taken(s) = 1
    and dbg1_t.ev(tp, 'late_success_recorded') = 1);
  o := pkg1c_t.cb('s10a');
  perform pg_temp.chk('S10d callback berulang: duplicate_ignored; tiada acara atau rekod tambahan', o = 'duplicate_ignored'
    and dbg1_t.ev(tp, 'late_success_recorded') = 1 and dbg1_t.pays(r) = 2, o);
  -- (b) provider failure after supersession.
  r := pkg1c_t.reg(s, 's10b'); tp := pkg1c_t.bill(r, 's10b');
  perform dbg1_t.staff(r, 'SYN-A', 'BANK S10B', dbg1_t.u('s10b'));
  o := pkg1d_t.fail('s10b');
  perform pg_temp.chk('S10b callback gagal selepas supersede: duplicate_ignored, tiada perubahan', o = 'duplicate_ignored'
    and pkg1d_t.att(tp) = 'cancelled/-/-' and pkg1c_t.state(r) = 'confirmed/paid/nohold', o);
  -- (c) bill creation claimed (no URL yet) when staff verifies; attach afterwards is refused.
  r := pkg1c_t.reg(s, 's10c'); att := dbg1_t.claim_bill(r, 's10c');
  perform pg_temp.chk('S10c persediaan: percubaan pending/claimed', (select status || '/' || bill_creation_state from public.public_registration_payments where id = att) = 'pending/claimed');
  perform dbg1_t.staff(r, 'SYN-A', 'BANK S10C', dbg1_t.u('s10c'));
  o := dbg1_t.attach(att, 's10c');
  perform pg_temp.chk('S10c attach selepas supersede: payment_attempt_not_attachable; percubaan kekal cancelled tanpa URL', o like 'ERR:payment_attempt_not_attachable%'
    and (select status = 'cancelled' and payment_url is null from public.public_registration_payments where id = att), o);
end $$;

-- S11: same request UUID replay.
do $$ declare s uuid; r uuid; o text; n integer; e integer; begin
  s := pkg1c_t.schedule('s11', 5); r := pkg1c_t.reg(s, 's11');
  perform dbg1_t.staff(r, 'SYN-A', 'BANK S11', dbg1_t.u('s11'));
  n := dbg1_t.pays(r); e := dbg1_t.ev_all(dbg1_t.ref(r));
  o := dbg1_t.staff(r, 'SYN-A', 'bank   s11', dbg1_t.u('s11'), p_notes => 'Nota lain untuk ulangan');
  perform pg_temp.chk('S11 ulangan UUID sama (rujukan ternormal sama, nota lain): already_recorded; 0 rekod, 0 acara; nota asal kekal',
    o = 'already_recorded|-' and dbg1_t.pays(r) = n and dbg1_t.ev_all(dbg1_t.ref(r)) = e
    and (select raw_response->>'notes' from public.public_registration_payments where id = dbg1_t.bank_id(r)) = 'Penyata bank disemak 2026', o);
  update public.course_schedules set status = 'cancelled' where id = s;
  o := dbg1_t.staff(r, 'SYN-A', 'BANK S11', dbg1_t.u('s11'));
  perform pg_temp.chk('S11 ulangan selepas jadual dibatalkan: already_recorded, tiada perubahan', o = 'already_recorded|-' and dbg1_t.pays(r) = n, o);
end $$;

-- S12: same request UUID with a conflicting payload.
do $$ declare s uuid; r uuid; r2 uuid; o text; begin
  s := pkg1c_t.schedule('s12', 5); r := pkg1c_t.reg(s, 's12'); r2 := pkg1c_t.reg(s, 's12b');
  perform dbg1_t.staff(r, 'SYN-A', 'BANK S12', dbg1_t.u('s12'));
  o := dbg1_t.staff(r, 'SYN-A', 'BANK S12', dbg1_t.u('s12'), 99.99, true);
  perform pg_temp.chk('S12 UUID sama, amaun lain: request_id_conflict', o like 'ERR:P0001:request_id_conflict%', o);
  o := dbg1_t.staff(r, 'SYN-B', 'BANK S12', dbg1_t.u('s12'));
  perform pg_temp.chk('S12 UUID sama, akaun lain: request_id_conflict', o like 'ERR:P0001:request_id_conflict%', o);
  o := dbg1_t.staff(r, 'SYN-A', 'BANK S12 X', dbg1_t.u('s12'));
  perform pg_temp.chk('S12 UUID sama, rujukan lain: request_id_conflict', o like 'ERR:P0001:request_id_conflict%', o);
  o := dbg1_t.staff(r2, 'SYN-A', 'BANK S12', dbg1_t.u('s12'));
  perform pg_temp.chk('S12 UUID sama, pendaftaran lain: request_id_conflict; pendaftaran lain tidak berubah', o like 'ERR:P0001:request_id_conflict%'
    and dbg1_t.pays(r2) = 0 and pkg1c_t.state(r2) = 'pending_payment/pending/hold', o);
  perform pg_temp.chk('S12 masih tepat 1 rekod dan 1 acara manual untuk permintaan asal', dbg1_t.pays(r) = 1 and dbg1_t.ev_ref(dbg1_t.ref(r), 'manual_payment_recorded') = 1);
end $$;

-- S15: audit integrity, data minimisation and direct writes.
do $$ declare s uuid; r uuid; b uuid; o text; begin
  s := pkg1c_t.schedule('s15', 5); r := pkg1c_t.reg(s, 's15', 2);
  perform dbg1_t.staff(r, 'SYN-A', 'BANK S15', dbg1_t.u('s15'));
  b := dbg1_t.bank_id(r);
  perform pg_temp.chk('S15 acara staf tanpa PII peserta (tiada IC, e-mel atau nama peserta dalam metadata atau raw_response)',
    not exists (select 1 from public.audit_logs where entity_id = b::text and (metadata::text ~ 'SYN[0-9A-F]{9}' or metadata::text like '%@example.invalid%' or metadata::text like '%SYNTHETIC PKG1C%'))
    and (select raw_response::text !~ 'SYN[0-9A-F]{9}' and raw_response::text not like '%SYNTHETIC PKG1C%' from public.public_registration_payments where id = b));
  o := dbg1_t.as_role('authenticated', '00000000-0000-0000-0000-00000000a001', format('update public.public_registration_payments set amount = 1 where id = %L', b));
  perform pg_temp.chk('S15 UPDATE terus bayaran sebagai admin authenticated: ditolak (RLS/hak)', o like 'ERR:%' or o = 'OK:0', o);
  o := dbg1_t.as_role('authenticated', '00000000-0000-0000-0000-00000000a001', format(
    $q$insert into public.public_registration_payments (registration_id, payment_provider, status, amount, currency) values (%L, 'bank_transfer', 'paid', 100, 'MYR')$q$, r));
  perform pg_temp.chk('S15 INSERT terus rekod paid sebagai admin authenticated: ditolak', o like 'ERR:%', o);
  o := dbg1_t.as_role('service_role', null, format('update public.public_registration_payments set staff_request_id = gen_random_uuid() where id = %L', b));
  perform pg_temp.chk('S15 staff_request_id tidak boleh diubah (walaupun service_role)', o like 'ERR:P0001:payment_staff_request_id_immutable%', o);
  o := dbg1_t.as_role('service_role', null, format('update public.public_registration_payments set receiving_account_id = %L where id = %L', dbg1_t.acct('SYN-B'), b));
  perform pg_temp.chk('S15 receiving_account_id tidak boleh diubah (walaupun service_role)', o like 'ERR:P0001:payment_receiving_account_immutable%', o);
  begin
    insert into public.public_registration_payments (registration_id, payment_provider, status, amount, currency, staff_request_id)
    values (r, 'bank_transfer', 'pending', 100, 'MYR', dbg1_t.u('s15'));
    o := 'inserted';
  exception when others then o := sqlstate;
  end;
  perform pg_temp.chk('S15 indeks unik staff_request_id: sisipan UUID pendua ditolak (23505)', o = '23505', o);
  begin
    update public.payment_receiving_accounts set account_last4 = '9999' where code = 'SYN-A';
    o := 'updated';
  exception when others then o := sqlerrm;
  end;
  perform pg_temp.chk('S15 identiti akaun penerima (4 digit) tidak boleh diubah', o = 'receiving_account_identity_immutable', o);
end $$;

-- S16i: an unexpected error during CRM finalization still propagates and rolls the whole call back (no exception handler).
-- The failure is injected with a trigger created inside this rolled-back check transaction of the disposable database.
do $$ declare s uuid; r uuid; o text; begin
  s := pkg1c_t.schedule('s16i', 5); r := pkg1c_t.reg(s, 's16i');
  create function public.dbg1_inject_failure() returns trigger language plpgsql as $f$ begin raise exception 'dbg1_injected_failure'; end $f$;
  create trigger dbg1_inject before insert on public.schedule_participants for each row execute function public.dbg1_inject_failure();
  o := dbg1_t.staff(r, 'SYN-A', 'BANK S16I', dbg1_t.u('s16i'));
  drop trigger dbg1_inject on public.schedule_participants;
  drop function public.dbg1_inject_failure();
  perform pg_temp.chk('S16i ralat tidak dijangka semasa enrolmen: raise (tidak ditukar menjadi reconciliation_required)', o like 'ERR:P0001:dbg1_injected_failure%', o);
  perform pg_temp.chk('S16i seluruh panggilan di-rollback: tiada rekod bank, tiada acara, pendaftaran tidak berubah',
    dbg1_t.pays(r) = 0 and dbg1_t.ev_all(dbg1_t.ref(r)) = 0 and pkg1c_t.state(r) = 'pending_payment/pending/hold', pkg1c_t.state(r));
end $$;

-- S17: additional-funds CLAIM (unverified claim, separate ledger).
do $$ declare s uuid; r uuid; rn uuid; j jsonb; o text; af uuid; n integer; begin
  s := pkg1c_t.schedule('s17', 5); r := pkg1c_t.reg(s, 's17');
  perform pkg1c_t.bill(r, 's17'); perform pkg1c_t.cb('s17');
  n := dbg1_t.pays(r);
  j := dbg1_t.claimj(r, 'SYN-A', 50, 'EXTRA 17', dbg1_t.u('c17'));
  af := dbg1_t.af_id(dbg1_t.u('c17'));
  perform pg_temp.chk('S17 tuntutan dana tambahan (pendaftaran sudah dibayar): claimed, belum disahkan', j->>'outcome' = 'claimed' and j->>'status' = 'claimed', j::text);
  perform pg_temp.chk('S17 1 baris claimed: amaun, akaun, tarikh, related_payment_ids = bayaran paid sedia ada, claimed_by = admin',
    dbg1_t.afs(r) = 1 and exists (select 1 from public.public_registration_additional_funds where id = af and status = 'claimed' and amount = 50
      and receiving_account_id = dbg1_t.acct('SYN-A') and transferred_on = dbg1_t.today() and payment_reference = 'EXTRA 17'
      and related_payment_ids = array[dbg1_t.tp_id(r)] and claimed_by = '00000000-0000-0000-0000-00000000a001' and decided_by is null));
  perform pg_temp.chk('S17 tepat 1 acara additional_funds_claimed (verified=false, seat_allocated=false)',
    dbg1_t.ev(af, 'additional_funds_claimed') = 1 and (select metadata->>'verified' = 'false' and metadata->>'seat_allocated' = 'false'
      from public.audit_logs where entity_id = af::text and metadata->>'event' = 'additional_funds_claimed'));
  perform pg_temp.chk('S17 tiada perubahan pada bayaran, pendaftaran atau kerusi', dbg1_t.pays(r) = n and pkg1c_t.state(r) = 'confirmed/paid/nohold'
    and pkg1c_t.enrolled(s) = 1);
  o := dbg1_t.claim(r, 'SYN-A', 50, 'extra17', dbg1_t.u('c17'));
  perform pg_temp.chk('S17 ulangan sama: already_recorded; 1 baris; 1 acara', o = 'already_recorded' and dbg1_t.afs(r) = 1
    and dbg1_t.ev(af, 'additional_funds_claimed') = 1, o);
  o := dbg1_t.claim(r, 'SYN-A', 60, 'EXTRA 17', dbg1_t.u('c17'));
  perform pg_temp.chk('S17 UUID sama, amaun lain: request_id_conflict', o like 'ERR:P0001:request_id_conflict%', o);
  rn := pkg1c_t.reg(s, 's17n');
  o := dbg1_t.claim(rn, 'SYN-A', 50, 'EXTRA 17N', dbg1_t.u('c17n'));
  perform pg_temp.chk('S17 pendaftaran belum dibayar: registration_not_paid (bukan pintu belakang)', o like 'ERR:P0001:registration_not_paid%' and dbg1_t.afs(rn) = 0, o);
  o := dbg1_t.claim(r, 'SYN-C', 50, 'EXTRA 17C', dbg1_t.u('c17c'));
  perform pg_temp.chk('S17 akaun tidak aktif: invalid_receiving_account', o like 'ERR:P0001:invalid_receiving_account%', o);
  o := dbg1_t.claim(r, 'SYN-A', 50, 'EXTRA 17D', dbg1_t.u('c17d'), p_notes => 'ok 1');
  perform pg_temp.chk('S17 nota pendek: invalid_additional_funds_notes', o like 'ERR:P0001:invalid_additional_funds_notes%', o);
  o := dbg1_t.claim(r, 'SYN-A', 50, 'EXTRA 17E', dbg1_t.u('c17e'), p_on => dbg1_t.today() + 1);
  perform pg_temp.chk('S17 tarikh pindahan masa depan: invalid_additional_funds_claim', o like 'ERR:P0001:invalid_additional_funds_claim%', o);
  o := dbg1_t.claim(r, 'SYN-A', 50, 'EXTRA 17F', dbg1_t.u('c17f'), p_on => dbg1_t.today() - 400);
  perform pg_temp.chk('S17 tarikh pindahan sebelum pendaftaran: invalid_additional_funds_claim', o like 'ERR:P0001:invalid_additional_funds_claim%', o);
  o := dbg1_t.claim(r, 'SYN-A', 0, 'EXTRA 17G', dbg1_t.u('c17g'));
  perform pg_temp.chk('S17 amaun sifar: invalid_additional_funds_claim', o like 'ERR:P0001:invalid_additional_funds_claim%', o);
  o := dbg1_t.claim(r, 'SYN-A', 50, 'EXTRA 17H', dbg1_t.u('c17h'), p_as => '00000000-0000-0000-0000-00000000e001');
  perform pg_temp.chk('S17 editor: 42501 not_authorized', o like 'ERR:42501:not_authorized%', o);
  perform pg_temp.chk('S17 hanya satu baris kekal selepas semua tuntutan yang ditolak', dbg1_t.afs(r) = 1);
  -- A claim whose reference equals an existing bank record of the same account: flagged, not rejected.
  rn := pkg1c_t.reg(s, 's17p');
  perform dbg1_t.staff(rn, 'SYN-A', 'SHARED-17', dbg1_t.u('s17p'));
  j := dbg1_t.claimj(r, 'SYN-A', 40, ' shared-17 ', dbg1_t.u('c17p'));
  perform pg_temp.chk('S17 rujukan sama dengan rekod bank akaun yang sama: claimed + possible_duplicate_reference (tidak ditolak)',
    j->>'outcome' = 'claimed' and j->>'possible_duplicate_reference' = 'true'
    and (select duplicate_reference_candidates from public.public_registration_additional_funds where claim_request_id = dbg1_t.u('c17p')) = array[dbg1_t.bank_id(rn)], j::text);
  begin
    insert into public.public_registration_additional_funds (registration_id, receiving_account_id, amount, transferred_on, payment_reference,
      claim_request_id, related_payment_ids, claimed_by, claim_notes)
    values (r, dbg1_t.acct('SYN-A'), 1, dbg1_t.today(), 'DIRECT 1', dbg1_t.u('c17'), array[dbg1_t.tp_id(r)], '00000000-0000-0000-0000-00000000a001', 'direct insert test');
    o := 'inserted';
  exception when others then o := sqlstate;
  end;
  perform pg_temp.chk('S17 kekangan unik claim_request_id: sisipan UUID pendua ditolak (23505)', o = '23505', o);
end $$;

-- S18: additional-funds DECISION (four-eyes, final, immutable).
do $$ declare s uuid; r uuid; o text; af uuid; af2 uuid; n integer; begin
  s := pkg1c_t.schedule('s18', 5); r := pkg1c_t.reg(s, 's18');
  perform pkg1c_t.bill(r, 's18'); perform pkg1c_t.cb('s18');
  perform dbg1_t.claim(r, 'SYN-A', 30, 'EXTRA 18', dbg1_t.u('c18'));
  af := dbg1_t.af_id(dbg1_t.u('c18'));
  n := dbg1_t.pays(r);
  o := dbg1_t.decide(af, 'verified', dbg1_t.u('d18-self'), p_as => '00000000-0000-0000-0000-00000000a001');
  perform pg_temp.chk('S18 pembuat tuntutan cuba mengesahkan sendiri: four_eyes_required (42501); kekal claimed',
    o like 'ERR:42501:four_eyes_required%' and (select status from public.public_registration_additional_funds where id = af) = 'claimed', o);
  o := dbg1_t.decide(af, 'verified', dbg1_t.u('d18'), p_as => '00000000-0000-0000-0000-00000000e001');
  perform pg_temp.chk('S18 editor memutuskan: 42501 not_authorized', o like 'ERR:42501:not_authorized%', o);
  o := dbg1_t.decide(af, 'verified', dbg1_t.u('d18'), p_notes => 'ok');
  perform pg_temp.chk('S18 nota keputusan pendek: invalid_additional_funds_notes', o like 'ERR:P0001:invalid_additional_funds_notes%', o);
  o := dbg1_t.decide(af, 'verified', dbg1_t.u('d18'));
  perform pg_temp.chk('S18 admin kedua mengesahkan: decided -> verified; decided_by = admin kedua; 1 acara additional_funds_verified',
    o = 'decided' and exists (select 1 from public.public_registration_additional_funds where id = af and status = 'verified'
      and decided_by = '00000000-0000-0000-0000-00000000b001' and decision_request_id = dbg1_t.u('d18') and decided_at is not null)
    and dbg1_t.ev(af, 'additional_funds_verified') = 1, o);
  o := dbg1_t.decide(af, 'verified', dbg1_t.u('d18'));
  perform pg_temp.chk('S18 ulangan keputusan: already_decided; 0 acara tambahan', o = 'already_decided' and dbg1_t.ev(af, 'additional_funds_verified') = 1, o);
  o := dbg1_t.decide(af, 'rejected', dbg1_t.u('d18'));
  perform pg_temp.chk('S18 UUID keputusan sama, keputusan lain: request_id_conflict', o like 'ERR:P0001:request_id_conflict%', o);
  o := dbg1_t.decide(af, 'rejected', dbg1_t.u('d18b'), p_as => '00000000-0000-0000-0000-00000000f001');
  perform pg_temp.chk('S18 keputusan kedua (rejected selepas verified): invalid_additional_funds_transition (muktamad)',
    o like 'ERR:P0001:invalid_additional_funds_transition%' and (select status from public.public_registration_additional_funds where id = af) = 'verified', o);
  perform pg_temp.chk('S18 tiada perubahan pada bayaran, pendaftaran atau kerusi', dbg1_t.pays(r) = n and pkg1c_t.state(r) = 'confirmed/paid/nohold' and pkg1c_t.enrolled(s) = 1);
  perform dbg1_t.claim(r, 'SYN-B', 20, 'EXTRA 18B', dbg1_t.u('c18b'));
  af2 := dbg1_t.af_id(dbg1_t.u('c18b'));
  o := dbg1_t.decide(af2, 'rejected', dbg1_t.u('d18'));
  perform pg_temp.chk('S18 UUID keputusan yang sudah digunakan pada tuntutan lain: request_id_conflict', o like 'ERR:P0001:request_id_conflict%', o);
  o := dbg1_t.decide(af2, 'rejected', dbg1_t.u('d18c'), p_as => '00000000-0000-0000-0000-00000000f001');
  perform pg_temp.chk('S18 super_admin menolak tuntutan lain: rejected; 1 acara additional_funds_rejected', o = 'decided'
    and (select status from public.public_registration_additional_funds where id = af2) = 'rejected' and dbg1_t.ev(af2, 'additional_funds_rejected') = 1, o);
  o := dbg1_t.decide(af2, 'verified', dbg1_t.u('d18x'));
  perform pg_temp.chk('S18 rejected adalah muktamad', o like 'ERR:P0001:invalid_additional_funds_transition%', o);
  -- Database-level guards (owner-privileged direct writes, as a buggy future code path would do).
  begin update public.public_registration_additional_funds set amount = 999 where id = af; o := 'updated';
  exception when others then o := sqlerrm; end;
  perform pg_temp.chk('S18 medan wang tidak boleh diubah selepas sisipan (pengawal)', o = 'additional_funds_claim_immutable', o);
  begin delete from public.public_registration_additional_funds where id = af; o := 'deleted';
  exception when others then o := sqlerrm; end;
  perform pg_temp.chk('S18 DELETE ditolak (pengawal)', o = 'additional_funds_delete_forbidden', o);
  begin update public.public_registration_additional_funds set status = 'verified', decided_by = claimed_by, decided_at = now(),
      decision_request_id = gen_random_uuid(), decision_notes = 'direct same person'
    where claim_request_id = dbg1_t.u('c18-none');
    perform dbg1_t.claim(r, 'SYN-A', 10, 'EXTRA 18Z', dbg1_t.u('c18z'));
    update public.public_registration_additional_funds set status = 'verified', decided_by = claimed_by, decided_at = now(),
      decision_request_id = gen_random_uuid(), decision_notes = 'direct same person' where claim_request_id = dbg1_t.u('c18z');
    o := 'updated';
  exception when others then o := sqlstate || ':' || sqlerrm; end;
  perform pg_temp.chk('S18 kekangan pangkalan data four-eyes: decided_by = claimed_by ditolak (23514)', o like '23514:%four_eyes%', o);
  begin update public.public_registration_additional_funds set status = 'settled' where id = af2; o := 'updated';
  exception when others then o := sqlerrm; end;
  perform pg_temp.chk('S18 status settled tidak diaktifkan', o <> 'updated', o);
  o := dbg1_t.as_role('service_role', null, format('update public.public_registration_additional_funds set decision_notes = %L where id = %L', 'tamper attempt', af));
  perform pg_temp.chk('S18 service_role tidak boleh menulis terus ke dana tambahan', o like 'ERR:42501:%', o);
end $$;

select 'RESULT|' || case when ok then 'PASS' else 'FAIL' end || '|' || name || '|' || replace(detail, '|', '/') from t_results order by ord;
