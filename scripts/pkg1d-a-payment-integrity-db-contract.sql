-- Synthetic fixtures only. Executed by pkg1d-a-payment-integrity-db-contract.mts against a disposable local PostgreSQL
-- holding Baseline V3 + 20261106090000 + PKG-1 + PKG-1c + the four PKG-1d-A migrations. Never run elsewhere. The runner
-- first loads the pkg1c_t helpers from scripts/pkg1c-capacity-finalization-db-contract.sql (unchanged), then the
-- @@helpers section below (committed once), and runs @@checks inside BEGIN ... ROLLBACK so the checks can be repeated
-- against mutated migrations on the same database.

-- @@helpers
create schema if not exists pkg1d_t;

-- Current ToyyibPay attempt of a registration (newest pending/processing one).
create or replace function pkg1d_t.open_attempt(p_reg uuid) returns uuid
language sql as $$
  select id from public.public_registration_payments
  where registration_id = p_reg and payment_provider = 'toyyibpay' and status in ('pending', 'processing')
  order by created_at desc limit 1
$$;

-- A further ToyyibPay attempt for the same registration (the payer retries): the real begin + attach RPCs.
create or replace function pkg1d_t.rebill(p_reg uuid, p_key text, p_bill text) returns text
language plpgsql as $$
begin
  perform pkg1c_t.ctx('service_role');
  perform public.begin_public_registration_payment((select registration_reference from public.public_registrations where id = p_reg), pkg1c_t.secret(p_key));
  perform public.attach_public_registration_toyy_pay_bill(pkg1d_t.open_attempt(p_reg), 'BILL-' || p_bill, 'https://example.invalid/pay/' || p_bill);
  return 'OK';
exception when others then
  return 'ERR:' || sqlerrm;
end $$;

-- ToyyibPay reports the attempt unsuccessful (the real callback RPC).
create or replace function pkg1d_t.fail(p_bill text) returns text
language plpgsql as $$
declare r jsonb;
begin
  perform pkg1c_t.ctx('service_role');
  r := public.mark_public_registration_payment_failed_from_callback(
    (select id from public.public_registration_payments where provider_bill_code = 'BILL-' || p_bill), 'BILL-' || p_bill, now(), 'synthetic unsuccessful');
  return r->>'outcome';
exception when others then
  return 'ERR:' || sqlerrm;
end $$;

-- The payer asks for a bill again (real begin RPC).
create or replace function pkg1d_t.begin(p_reg uuid, p_key text) returns text
language plpgsql as $$
begin
  perform pkg1c_t.ctx('service_role');
  perform public.begin_public_registration_payment((select registration_reference from public.public_registrations where id = p_reg), pkg1c_t.secret(p_key));
  return 'OK';
exception when others then
  return 'ERR:' || sqlerrm;
end $$;

-- Manual bank transfer with a chosen verifier and caller role.
create or replace function pkg1d_t.manual_as(p_reg uuid, p_key text, p_verifier uuid, p_role text default 'service_role', p_amount numeric default null) returns text
language plpgsql as $$
declare v_reg public.public_registrations%rowtype; r jsonb;
begin
  if p_role = 'service_role' then perform pkg1c_t.ctx('service_role'); else perform pkg1c_t.ctx('authenticated', p_verifier::text); end if;
  select * into v_reg from public.public_registrations where id = p_reg;
  r := public.verify_public_registration_manual_payment(v_reg.registration_reference, pkg1c_t.secret(p_key),
    coalesce(p_amount, v_reg.amount_snapshot), 'BANK-' || p_key, 'synthetic', case when p_role = 'service_role' then p_verifier else null end);
  return r->>'outcome';
exception when others then
  return 'ERR:' || sqlstate || ':' || sqlerrm;
end $$;

-- Owner-privileged writer that imitates a (buggy or compromised) callback finalization path: it runs as the callback
-- function's owner, may or may not set the provenance marker, and writes failed|cancelled -> paid with chosen fields.
-- It exists only to test each condition of the late-success guard one by one.
create or replace function pkg1d_t.forge(p_attempt uuid, p_txn text, p_amount numeric, p_verified boolean, p_marker boolean, p_evidence boolean)
returns text language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if p_marker then perform set_config('app.pkg1d_late_success_attempt', p_attempt::text, true); end if;
  update public.public_registration_payments
  set status = 'paid', provider_transaction_id = p_txn, verified_amount = p_amount,
      verified_at = case when p_verified then now() else null end,
      raw_response = coalesce(raw_response, '{}'::jsonb) || case when p_evidence then '{"late_success":{"synthetic":true}}'::jsonb else '{}'::jsonb end
  where id = p_attempt;
  perform set_config('app.pkg1d_late_success_attempt', '', true);
  return 'OK';
exception when others then
  perform set_config('app.pkg1d_late_success_attempt', '', true);
  return 'ERR:' || sqlerrm;
end $$;
alter function pkg1d_t.forge(uuid, text, numeric, boolean, boolean, boolean) owner to postgres;
grant usage on schema pkg1d_t to postgres;

-- A direct UPDATE by another role (with the marker set, all fields valid): must be refused by provenance.
create or replace function pkg1d_t.direct_as(p_role text, p_attempt uuid, p_status text) returns text
language plpgsql as $$
begin
  perform set_config('app.pkg1d_late_success_attempt', p_attempt::text, true);
  if p_role <> 'superuser' then execute format('set local role %I', p_role); end if;
  update public.public_registration_payments
  set status = p_status, provider_transaction_id = coalesce(provider_transaction_id, 'TXN-DIRECT-' || left(p_attempt::text, 8)),
      verified_amount = amount, verified_at = now(),
      raw_response = coalesce(raw_response, '{}'::jsonb) || '{"late_success":{"direct":true}}'::jsonb
  where id = p_attempt;
  if p_role <> 'superuser' then reset role; end if;
  return 'OK';
exception when others then
  reset role;
  return 'ERR:' || sqlerrm;
end $$;

create or replace function pkg1d_t.att(p_attempt uuid) returns text
language sql as $$
  select status || '/' || coalesce(provider_transaction_id, '-') || '/' || coalesce(verified_amount::text, '-')
  from public.public_registration_payments where id = p_attempt
$$;
create or replace function pkg1d_t.bill_id(p_bill text) returns uuid
language sql as $$ select id from public.public_registration_payments where provider_bill_code = 'BILL-' || p_bill $$;
create or replace function pkg1d_t.events(p_entity uuid, p_event text) returns integer
language sql as $$
  select count(*)::integer from public.audit_logs where entity_id = p_entity::text and metadata->>'event' = p_event
$$;

-- Synthetic inactive admin (manual verifier must be an ACTIVE admin).
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000a002', 'pkg1d-inactive@example.invalid') on conflict do nothing;
insert into public.profiles (id, email, full_name, role, is_active) values
  ('00000000-0000-0000-0000-00000000a002', 'pkg1d-inactive@example.invalid', 'SYNTHETIC Inactive Admin', 'admin', false)
on conflict (id) do update set role = 'admin', is_active = false;

-- @@checks
create temp table t_results (name text, ok boolean, detail text);
create function pg_temp.chk(p_name text, p_ok boolean, p_detail text default '') returns void
language sql as $$ insert into t_results values (p_name, coalesce(p_ok, false), coalesce(p_detail, '')) $$;
create temp table t_reg (k text primary key, id uuid, sched uuid);
create function pg_temp.r(p_key text) returns uuid language sql as $$ select id from t_reg where k = p_key $$;
create function pg_temp.s(p_key text) returns uuid language sql as $$ select sched from t_reg where k = p_key $$;

-- T1: failed, then the same bill is paid (registration still open) -> recorded paid, no seat (B1).
do $$
declare s uuid; o text; a uuid;
begin
  s := pkg1c_t.schedule('t1', 5);
  insert into t_reg values ('t1', pkg1c_t.reg(s, 't1'), s);
  a := pkg1c_t.bill(pg_temp.r('t1'), 't1');
  o := pkg1d_t.fail('t1');
  perform pg_temp.chk('T1 persediaan: ToyyibPay gagal -> percubaan failed, pendaftaran failed/failed',
    o = 'failed' and pkg1d_t.att(a) = 'failed/-/-' and pkg1c_t.state(pg_temp.r('t1')) = 'failed/failed/hold', o || ' ' || pkg1d_t.att(a));
  o := pkg1c_t.cb('t1');
  perform pg_temp.chk('T1 gagal-kemudian-berjaya: reconciliation_required (tidak senyap)', o = 'reconciliation_required', o);
  perform pg_temp.chk('T1 percubaan direkod paid dengan txn dan amaun disahkan', pkg1d_t.att(a) = 'paid/TXN-t1/100.00', pkg1d_t.att(a));
  perform pg_temp.chk('T1 bukti late_success: status asal failed, provenance penyedia, verified_at ditetapkan',
    (select raw_response->'late_success'->>'original_status' = 'failed' and raw_response->'late_success'->>'provenance' = 'toyyibpay_get_bill_transactions'
       and (raw_response->>'late_success_reconciliation_required')::boolean and verified_at is not null
     from public.public_registration_payments where id = a));
  perform pg_temp.chk('T1 pendaftaran failed/paid (failed->processing->paid), tiada kerusi',
    pkg1c_t.state(pg_temp.r('t1')) = 'failed/paid/hold' and pkg1c_t.enrolled(s) = 0 and pkg1c_t.taken(s) = 0, pkg1c_t.state(pg_temp.r('t1')));
  perform pg_temp.chk('T1 acara audit late_success_recorded dengan amaun dan txn (tepat satu)',
    pkg1d_t.events(a, 'late_success_recorded') = 1 and exists (select 1 from public.audit_logs where entity_id = a::text
      and metadata->>'event' = 'late_success_recorded' and metadata->>'provider_transaction_id' = 'TXN-t1'
      and (metadata->>'verified_amount')::numeric = 100 and metadata->>'seat_allocated' = 'false'));
end $$;

-- T2: payer retried (bill B open), then the OLD bill A is paid -> A paid, B cancelled, no seat; begin refused (T10).
do $$
declare s uuid; o text; a uuid; b uuid;
begin
  s := pkg1c_t.schedule('t2', 5);
  insert into t_reg values ('t2', pkg1c_t.reg(s, 't2'), s);
  a := pkg1c_t.bill(pg_temp.r('t2'), 't2');
  perform pkg1d_t.fail('t2');
  o := pkg1d_t.rebill(pg_temp.r('t2'), 't2', 't2b');
  b := pkg1d_t.bill_id('t2b');
  perform pg_temp.chk('T2 persediaan: bil B dicipta selepas A gagal', o = 'OK' and pkg1d_t.att(b) = 'processing/-/-'
    and pkg1c_t.state(pg_temp.r('t2')) = 'payment_pending/processing/hold', o);
  o := pkg1c_t.cb('t2');
  perform pg_temp.chk('T2 bil lama A dibayar: reconciliation_required', o = 'reconciliation_required', o);
  perform pg_temp.chk('T2 A paid, B dibatalkan (tidak lagi ditawarkan)', pkg1d_t.att(a) = 'paid/TXN-t2/100.00' and pkg1d_t.att(b) = 'cancelled/-/-'
    and (select raw_response->'cancelled_by_late_success'->>'paid_attempt_id' = a::text from public.public_registration_payments where id = b),
    pkg1d_t.att(a) || ' ' || pkg1d_t.att(b));
  perform pg_temp.chk('T2 pendaftaran payment_pending/paid, tiada kerusi', pkg1c_t.state(pg_temp.r('t2')) = 'payment_pending/paid/hold' and pkg1c_t.enrolled(s) = 0);
  perform pg_temp.chk('T2 acara mencatat 1 percubaan terbuka dibatalkan',
    exists (select 1 from public.audit_logs where entity_id = a::text and metadata->>'event' = 'late_success_recorded' and (metadata->>'cancelled_open_attempts')::int = 1));
  o := pkg1d_t.begin(pg_temp.r('t2'), 't2');
  perform pg_temp.chk('T10 begin pada pendaftaran yang sudah paid: registration_already_paid', o like 'ERR:registration_already_paid%', o);
  perform pg_temp.chk('T10 tiada percubaan baharu dicipta', (select count(*) from public.public_registration_payments where registration_id = pg_temp.r('t2')) = 2);
end $$;

-- T3: both bills paid (B normally, then A late) -> 2 paid money records, exactly one seat.
do $$
declare s uuid; o text; a uuid; b uuid;
begin
  s := pkg1c_t.schedule('t3', 5);
  insert into t_reg values ('t3', pkg1c_t.reg(s, 't3'), s);
  a := pkg1c_t.bill(pg_temp.r('t3'), 't3');
  perform pkg1d_t.fail('t3');
  perform pkg1d_t.rebill(pg_temp.r('t3'), 't3', 't3b');
  b := pkg1d_t.bill_id('t3b');
  o := pkg1c_t.cb('t3b');
  perform pg_temp.chk('T3 bil B dibayar: confirmed', o = 'confirmed', o);
  o := pkg1c_t.cb('t3');
  perform pg_temp.chk('T3 bil A kemudian juga dibayar: reconciliation_required', o = 'reconciliation_required', o);
  perform pg_temp.chk('T3 dua rekod wang paid (kedua-dua txn berbeza)', pkg1d_t.att(a) = 'paid/TXN-t3/100.00' and pkg1d_t.att(b) = 'paid/TXN-t3b/100.00');
  perform pg_temp.chk('T3 tepat satu kerusi (tiada peruntukan berganda)', pkg1c_t.enrolled(s) = 1 and pkg1c_t.taken(s) = 1 and pkg1c_t.reg_enrolled(pg_temp.r('t3')) = 1);
  o := pkg1c_t.retry(pg_temp.r('t3'), '00000000-0000-0000-0000-00000000a001');
  perform pg_temp.chk('T3 peruntukan admin semula: already_confirmed, kerusi kekal 1', o = 'already_confirmed' and pkg1c_t.enrolled(s) = 1, o);
end $$;

-- T4: D8 path -- attempt cancelled by expire_public_registrations, then paid -> recorded paid, expiry evidence kept.
do $$
declare s uuid; o text; a uuid;
begin
  s := pkg1c_t.schedule('t4', 5);
  insert into t_reg values ('t4', pkg1c_t.reg(s, 't4'), s);
  a := pkg1c_t.bill(pg_temp.r('t4'), 't4');
  perform pkg1c_t.expire_hold(pg_temp.r('t4'));
  perform pkg1c_t.ctx('service_role');
  perform public.expire_public_registrations();
  perform pg_temp.chk('T4 persediaan: expire membatalkan percubaan', pkg1d_t.att(a) = 'cancelled/-/-', pkg1d_t.att(a));
  o := pkg1c_t.cb('t4');
  perform pg_temp.chk('T4 bayaran pada percubaan cancelled: reconciliation_required', o = 'reconciliation_required', o);
  perform pg_temp.chk('T4 percubaan paid (bukan lagi cancelled dengan verified_amount NULL)', pkg1d_t.att(a) = 'paid/TXN-t4/100.00', pkg1d_t.att(a));
  perform pg_temp.chk('T4 bukti expire dikekalkan (gabung, bukan tulis ganti)',
    (select raw_response->>'reason' = 'registration_hold_expired' and raw_response ? 'expired_at' and raw_response->'late_success'->>'original_status' = 'cancelled'
     from public.public_registration_payments where id = a));
  perform pg_temp.chk('T4 pendaftaran expired/paid, tiada kerusi', pkg1c_t.state(pg_temp.r('t4')) like 'expired/paid/%' and pkg1c_t.enrolled(s) = 0, pkg1c_t.state(pg_temp.r('t4')));
end $$;

-- T5/T6: replays.
do $$
declare o text; n integer;
begin
  n := (select count(*) from public.audit_logs where metadata->>'event' = 'late_success_recorded');
  o := pkg1c_t.cb('t1');
  perform pg_temp.chk('T5 replay txn sama (lewat, failed): duplicate_ignored', o = 'duplicate_ignored', o);
  o := pkg1c_t.cb('t4');
  perform pg_temp.chk('T5 replay txn sama (lewat, cancelled): duplicate_ignored', o = 'duplicate_ignored', o);
  o := pkg1c_t.cb('t3b');
  perform pg_temp.chk('T5 replay txn sama (laluan biasa): duplicate_ignored', o = 'duplicate_ignored', o);
  perform pg_temp.chk('T5 tiada acara atau rekod wang tambahan selepas replay',
    (select count(*) from public.audit_logs where metadata->>'event' = 'late_success_recorded') = n
    and (select count(*) from public.public_registration_payments where provider_transaction_id like 'TXN-t%' and status = 'paid') = 5);
  o := pkg1c_t.cb('t1', null, 'TXN-t1-OTHER');
  perform pg_temp.chk('T6 replay txn berbeza: paid_attempt_conflict', o like 'ERR:paid_attempt_conflict%', o);
  perform pg_temp.chk('T6 txn asal kekal', pkg1d_t.att(pkg1d_t.bill_id('t1')) = 'paid/TXN-t1/100.00');
end $$;

-- T7: a transaction id that already belongs to another attempt.
do $$
declare s uuid; o text; a uuid;
begin
  s := pkg1c_t.schedule('t7', 5);
  insert into t_reg values ('t7', pkg1c_t.reg(s, 't7'), s);
  a := pkg1c_t.bill(pg_temp.r('t7'), 't7');
  perform pkg1d_t.fail('t7');
  o := pkg1c_t.cb('t7', null, 'TXN-t1');
  perform pg_temp.chk('T7 txn milik percubaan lain: transaction_conflict (tiada ralat tidak dikendalikan)', o = 'transaction_conflict', o);
  perform pg_temp.chk('T7 percubaan tidak berubah (failed, tiada txn)', pkg1d_t.att(a) = 'failed/-/-', pkg1d_t.att(a));
  perform pg_temp.chk('T7 konflik disimpan sekali mengikut txn dan diaudit',
    (select raw_response->'transaction_conflicts' ? 'TXN-t1' from public.public_registration_payments where id = a) and pkg1d_t.events(a, 'transaction_conflict') = 1);
  o := pkg1c_t.cb('t7', null, 'TXN-t1');
  perform pg_temp.chk('T7 replay konflik: tiada acara kedua', o = 'transaction_conflict' and pkg1d_t.events(a, 'transaction_conflict') = 1, o);
  perform pg_temp.chk('T7 txn TXN-t1 masih satu rekod wang sahaja',
    (select count(*) from public.public_registration_payments where provider_transaction_id = 'TXN-t1') = 1);
end $$;

-- T8: amount mismatch -- evidence, never paid, never blocks the correct payment.
do $$
declare s uuid; o text; a uuid;
begin
  s := pkg1c_t.schedule('t8', 5);
  insert into t_reg values ('t8', pkg1c_t.reg(s, 't8'), s);
  a := pkg1c_t.bill(pg_temp.r('t8'), 't8');
  o := pkg1c_t.cb('t8', 99.99, 'TXN-t8-LOW');
  perform pg_temp.chk('T8 amaun kurang: amount_mismatch (tiada raise)', o = 'amount_mismatch', o);
  perform pg_temp.chk('T8 percubaan kekal processing, txn tidak disimpan, verified_amount NULL', pkg1d_t.att(a) = 'processing/-/-', pkg1d_t.att(a));
  perform pg_temp.chk('T8 bukti amaun penyedia disimpan dikunci txn',
    (select (raw_response->'amount_mismatch'->'TXN-t8-LOW'->>'provider_amount')::numeric = 99.99
        and (raw_response->'amount_mismatch'->'TXN-t8-LOW'->>'expected_amount')::numeric = 100
     from public.public_registration_payments where id = a));
  perform pg_temp.chk('T8 pendaftaran tidak berubah, tiada kerusi', pkg1c_t.state(pg_temp.r('t8')) = 'payment_pending/processing/hold' and pkg1c_t.enrolled(s) = 0);
  o := pkg1c_t.cb('t8', 99.99, 'TXN-t8-LOW');
  perform pg_temp.chk('T8 replay amaun salah: satu bukti dan satu acara sahaja', o = 'amount_mismatch' and pkg1d_t.events(a, 'amount_mismatch_recorded') = 1, o);
  o := pkg1c_t.cb('t8', 150, 'TXN-t8-HIGH');
  perform pg_temp.chk('T8 amaun lebih: bukti kedua, tidak paid', o = 'amount_mismatch' and pkg1d_t.events(a, 'amount_mismatch_recorded') = 2
    and pkg1d_t.att(a) = 'processing/-/-', o);
  o := pkg1c_t.cb('t8');
  perform pg_temp.chk('T8 bayaran betul kemudian tidak tersekat: confirmed', o = 'confirmed' and pkg1d_t.att(a) = 'paid/TXN-t8/100.00', o);
  -- The normal path (unchanged PKG-1c) replaces raw_response with the provider row; the mismatch evidence stays in audit_logs.
  perform pg_temp.chk('T8 bukti amaun berbeza kekal dalam audit_logs selepas bayaran betul',
    (select count(*) from public.audit_logs where entity_id = a::text and metadata->>'event' = 'amount_mismatch_recorded'
       and metadata->>'provider_transaction_id' in ('TXN-t8-LOW', 'TXN-t8-HIGH')) = 2);
end $$;

-- T9: verified success on a refunded attempt is recorded once, never re-paid.
do $$
declare s uuid; o text; a uuid;
begin
  s := pkg1c_t.schedule('t9', 5);
  insert into t_reg values ('t9', pkg1c_t.reg(s, 't9'), s);
  a := pkg1c_t.bill(pg_temp.r('t9'), 't9');
  perform pkg1c_t.cb('t9');
  update public.public_registration_payments set status = 'refunded' where id = a;
  o := pkg1c_t.cb('t9');
  perform pg_temp.chk('T9 kejayaan selepas refunded: terminal_ignored, tidak paid semula', o = 'terminal_ignored' and pkg1d_t.att(a) = 'refunded/TXN-t9/100.00', o);
  perform pg_temp.chk('T9 dicatat sekali (bukan senyap)', pkg1d_t.events(a, 'success_after_refund') = 1);
  perform pkg1c_t.cb('t9');
  perform pg_temp.chk('T9 replay: tiada acara kedua', pkg1d_t.events(a, 'success_after_refund') = 1);
end $$;

-- T11/T12/T13 + U2: manual bank transfers.
do $$
declare s uuid; o text;
begin
  s := pkg1c_t.schedule('t11', 5);
  insert into t_reg values ('t11', pkg1c_t.reg(s, 't11'), s);
  perform pkg1c_t.bill(pg_temp.r('t11'), 't11');
  perform pkg1d_t.fail('t11');
  perform pg_temp.chk('T11 persediaan: payment_status failed', pkg1c_t.state(pg_temp.r('t11')) = 'failed/failed/hold');
  o := pkg1d_t.manual_as(pg_temp.r('t11'), 't11', '00000000-0000-0000-0000-00000000e001');
  perform pg_temp.chk('U2 pengesah editor ditolak: invalid_manual_verifier', o like 'ERR:42501:invalid_manual_verifier%', o);
  o := pkg1d_t.manual_as(pg_temp.r('t11'), 't11', '00000000-0000-0000-0000-00000000a002');
  perform pg_temp.chk('U2 pengesah admin tidak aktif ditolak', o like 'ERR:42501:invalid_manual_verifier%', o);
  o := pkg1d_t.manual_as(pg_temp.r('t11'), 't11', '00000000-0000-0000-0000-00000000e001', 'authenticated');
  perform pg_temp.chk('U2 pemanggil authenticated bukan admin: 42501', o like 'ERR:42501:%', o);
  o := pkg1d_t.manual_as(pg_temp.r('t11'), 't11', '00000000-0000-0000-0000-00000000a001', 'service_role', 50);
  perform pg_temp.chk('U2 amaun manual berbeza masih ditolak', o like 'ERR:P0001:manual_payment_amount_mismatch%', o);
  perform pg_temp.chk('U2 tiada rekod bank dicipta oleh percubaan yang ditolak',
    not exists (select 1 from public.public_registration_payments where registration_id = pg_temp.r('t11') and payment_provider = 'bank_transfer'));
  o := pkg1d_t.manual_as(pg_temp.r('t11'), 't11', '00000000-0000-0000-0000-00000000a001', 'authenticated');
  perform pg_temp.chk('T11 pindahan bank pada payment_status failed (admin authenticated): confirmed (B7)', o = 'confirmed', o);
  perform pg_temp.chk('T11 confirmed/paid, satu kerusi, rekod bank paid',
    pkg1c_t.state(pg_temp.r('t11')) = 'confirmed/paid/nohold' and pkg1c_t.enrolled(s) = 1
    and (select status from public.public_registration_payments where registration_id = pg_temp.r('t11') and payment_provider = 'bank_transfer') = 'paid');
  perform pg_temp.chk('T11 acara manual_payment_recorded dengan amaun dan rujukan',
    exists (select 1 from public.audit_logs where metadata->>'event' = 'manual_payment_recorded' and metadata->>'payment_reference' = 'BANK-t11'
      and (metadata->>'verified_amount')::numeric = 100 and actor_id = '00000000-0000-0000-0000-00000000a001'));

  s := pkg1c_t.schedule('t12', 5);
  insert into t_reg values ('t12', pkg1c_t.reg(s, 't12'), s);
  perform pkg1c_t.expire_hold(pg_temp.r('t12'));
  perform pkg1c_t.ctx('service_role');
  perform public.expire_public_registrations();
  o := pkg1d_t.manual_as(pg_temp.r('t12'), 't12', '00000000-0000-0000-0000-00000000a001');
  perform pg_temp.chk('T12 pindahan bank selepas expired: reconciliation_required (B5, tiada ralat)', o = 'reconciliation_required', o);
  perform pg_temp.chk('T12 expired/paid, rekod bank paid, tiada kerusi',
    pkg1c_t.state(pg_temp.r('t12')) like 'expired/paid/%' and pkg1c_t.enrolled(s) = 0
    and (select status || '/' || verified_amount from public.public_registration_payments where registration_id = pg_temp.r('t12') and payment_provider = 'bank_transfer') = 'paid/100.00',
    pkg1c_t.state(pg_temp.r('t12')));
  insert into t_reg values ('t12c', pkg1c_t.reg(s, 't12c'), s);
  update public.public_registrations set registration_status = 'cancelled' where id = pg_temp.r('t12c');
  o := pkg1d_t.manual_as(pg_temp.r('t12c'), 't12c', '00000000-0000-0000-0000-00000000a001');
  perform pg_temp.chk('T12 pindahan bank selepas cancelled: reconciliation_required, tiada kerusi', o = 'reconciliation_required' and pkg1c_t.enrolled(s) = 0, o);
  o := pkg1d_t.manual_as(pg_temp.r('t12'), 't12', '00000000-0000-0000-0000-00000000a001');
  perform pg_temp.chk('T12 pengesahan berulang: already_paid, satu rekod bank sahaja', o = 'already_paid'
    and (select count(*) from public.public_registration_payments where registration_id = pg_temp.r('t12')) = 1, o);

  o := pkg1d_t.manual_as(pg_temp.r('t3'), 't3', '00000000-0000-0000-0000-00000000a001');
  perform pg_temp.chk('T13 pindahan bank pada pendaftaran confirmed yang sudah dibayar: already_confirmed', o = 'already_confirmed', o);
  perform pg_temp.chk('T13 rekod wang ketiga direkod, kerusi kekal 1',
    (select count(*) from public.public_registration_payments where registration_id = pg_temp.r('t3') and status = 'paid') = 3 and pkg1c_t.enrolled(pg_temp.s('t3')) = 1);
end $$;

-- T14/T15: the late-success guard, condition by condition, and every other terminal rule.
do $$
declare s uuid; a uuid; o text;
begin
  s := pkg1c_t.schedule('t14', 5);
  insert into t_reg values ('t14', pkg1c_t.reg(s, 't14'), s);
  a := pkg1c_t.bill(pg_temp.r('t14'), 't14');
  perform pkg1d_t.fail('t14');
  o := pkg1d_t.forge(a, null, 100, true, true, true);
  perform pg_temp.chk('T14 pengawal: tanpa txn ditolak', o like 'ERR:invalid_late_success_transition%', o);
  o := pkg1d_t.forge(a, 'TXN-F1', 99, true, true, true);
  perform pg_temp.chk('T14 pengawal: amaun berbeza ditolak', o like 'ERR:invalid_late_success_transition%', o);
  o := pkg1d_t.forge(a, 'TXN-F1', 100, false, true, true);
  perform pg_temp.chk('T14 pengawal: tanpa verified_at ditolak', o like 'ERR:invalid_late_success_transition%', o);
  o := pkg1d_t.forge(a, 'TXN-F1', 100, true, true, false);
  perform pg_temp.chk('T14 pengawal: tanpa bukti late_success ditolak', o like 'ERR:invalid_late_success_transition%', o);
  o := pkg1d_t.forge(a, 'TXN-F1', 100, true, false, true);
  perform pg_temp.chk('T14 provenance: tanpa penanda fungsi callback ditolak (txn/amaun/masa sahaja bukan bukti)', o like 'ERR:invalid_late_success_transition%', o);
  o := pkg1d_t.direct_as('service_role', a, 'paid');
  perform pg_temp.chk('T14 provenance: UPDATE terus service_role (penanda ditetapkan, medan sah) ditolak', o like 'ERR:invalid_late_success_transition%', o);
  o := pkg1d_t.direct_as('superuser', a, 'paid');
  perform pg_temp.chk('T14 provenance: UPDATE terus superuser bukan pemilik ditolak', o like 'ERR:invalid_late_success_transition%', o);
  perform pg_temp.chk('T14 semua cubaan ditolak: percubaan kekal failed tanpa txn', pkg1d_t.att(a) = 'failed/-/-', pkg1d_t.att(a));
  o := pkg1d_t.forge(a, 'TXN-F1', 100, true, true, true);
  perform pg_temp.chk('T14 kawalan positif: penulis pemilik dengan penanda dan semua syarat: dibenarkan', o = 'OK' and pkg1d_t.att(a) = 'paid/TXN-F1/100.00', o);

  -- an attempt that already holds a transaction id cannot be paid with another one
  insert into t_reg values ('t14b', pkg1c_t.reg(s, 't14b'), s);
  a := pkg1c_t.bill(pg_temp.r('t14b'), 't14b');
  update public.public_registration_payments set status = 'cancelled', provider_transaction_id = 'TXN-OLD-t14b' where id = a;
  o := pkg1d_t.forge(a, 'TXN-NEW-t14b', 100, true, true, true);
  perform pg_temp.chk('T14 pengawal: txn sedia ada tidak boleh diganti', o like 'ERR:invalid_late_success_transition%', o);
  o := pkg1c_t.cb('t14b', null, 'TXN-NEW-t14b');
  perform pg_temp.chk('T14 callback dengan txn lain pada percubaan yang sudah ada txn: transaction_conflict', o = 'transaction_conflict' and pkg1d_t.att(a) = 'cancelled/TXN-OLD-t14b/-', o);

  insert into t_reg values ('t15', pkg1c_t.reg(s, 't15'), s);
  a := pkg1c_t.bill(pg_temp.r('t15'), 't15');
  perform pkg1d_t.fail('t15');
  o := pkg1d_t.direct_as('superuser', a, 'processing');
  perform pg_temp.chk('T15 failed -> processing masih ditolak', o like 'ERR:%' and pkg1d_t.att(a) = 'failed/-/-', o);
  o := pkg1d_t.direct_as('superuser', a, 'pending');
  perform pg_temp.chk('T15 failed -> pending masih ditolak', o like 'ERR:%', o);
  o := pkg1d_t.direct_as('superuser', pkg1d_t.bill_id('t9'), 'paid');
  perform pg_temp.chk('T15 refunded -> paid masih ditolak', o like 'ERR:%' and pkg1d_t.att(pkg1d_t.bill_id('t9')) like 'refunded/%', o);
  o := pkg1d_t.forge(pkg1d_t.bill_id('t9'), 'TXN-t9', 100, true, true, true);
  perform pg_temp.chk('T15 refunded -> paid ditolak walaupun melalui penulis pemilik dengan penanda', o like 'ERR:%', o);
  o := pkg1d_t.direct_as('superuser', pkg1d_t.bill_id('t1'), 'processing');
  perform pg_temp.chk('T15 paid -> processing masih ditolak', o like 'ERR:%', o);
  begin
    update public.public_registration_payments set provider_transaction_id = 'TXN-SWAP' where id = pkg1d_t.bill_id('t1');
    o := 'OK';
  exception when others then o := 'ERR:' || sqlerrm; end;
  perform pg_temp.chk('T15 txn pada percubaan paid kekal tidak boleh diubah', o like 'ERR:paid_public_payment_attempt_immutable%', o);
end $$;

-- T20-T22: adversarial inputs.
do $$
declare s uuid; o text; r jsonb;
begin
  s := pkg1c_t.schedule('t20', 5);
  insert into t_reg values ('t20a', pkg1c_t.reg(s, 't20a'), s);
  insert into t_reg values ('t20b', pkg1c_t.reg(s, 't20b'), s);
  perform pkg1c_t.bill(pg_temp.r('t20a'), 't20a');
  perform pkg1c_t.bill(pg_temp.r('t20b'), 't20b');
  begin
    perform pkg1c_t.ctx('service_role');
    r := public.finalize_public_registration_payment_from_callback(pkg1d_t.bill_id('t20a'), 'BILL-t20b', 100, 'TXN-X', now(), '{}');
    o := r->>'outcome';
  exception when others then o := 'ERR:' || sqlerrm; end;
  perform pg_temp.chk('T20 percubaan satu dengan bil yang lain: payment_bill_mismatch', o like 'ERR:payment_bill_mismatch%', o);
  o := pkg1c_t.cb('t20a', 0);
  perform pg_temp.chk('T21 amaun sifar: invalid_verified_payment', o like 'ERR:invalid_verified_payment%', o);
  o := pkg1c_t.cb('t20a', -100);
  perform pg_temp.chk('T21 amaun negatif: invalid_verified_payment', o like 'ERR:invalid_verified_payment%', o);
  o := pkg1c_t.cb('t20a', null, '   ');
  perform pg_temp.chk('T21 txn kosong: invalid_verified_payment', o like 'ERR:invalid_verified_payment%', o);
  perform pkg1d_t.fail('t20b');
  begin
    perform pkg1c_t.ctx('service_role');
    r := public.finalize_public_registration_payment_from_callback(pkg1d_t.bill_id('t20b'), 'BILL-t20b', 100, 'TXN-t20b', now(),
      jsonb_build_object('note', $x$'); drop table public.courses; --$x$, 'blob', repeat('A', 100000)));
    o := r->>'outcome';
  exception when others then o := 'ERR:' || sqlerrm; end;
  perform pg_temp.chk('T22 raw_response besar/berniat jahat disimpan sebagai jsonb sahaja', o = 'reconciliation_required'
    and to_regclass('public.courses') is not null
    and (select length(raw_response->'late_success'->'provider_response'->>'blob') from public.public_registration_payments where id = pkg1d_t.bill_id('t20b')) = 100000, o);
end $$;

-- U3: admin seat allocation after a late payment, capacity enforced.
do $$
declare s uuid; o text;
begin
  o := pkg1c_t.retry(pg_temp.r('t1'), '00000000-0000-0000-0000-00000000e001');
  perform pg_temp.chk('U3 editor tidak boleh memperuntukkan: 42501', o like 'ERR:42501:%', o);
  o := pkg1c_t.retry(pg_temp.r('t1'), '00000000-0000-0000-0000-00000000a001');
  perform pg_temp.chk('U3 admin memperuntukkan bayaran lewat (kerusi ada): confirmed', o = 'confirmed' and pkg1c_t.state(pg_temp.r('t1')) = 'confirmed/paid/nohold', o);
  perform pg_temp.chk('U3 satu kerusi', pkg1c_t.enrolled(pg_temp.s('t1')) = 1);
  o := pkg1c_t.retry(pg_temp.r('t1'), '00000000-0000-0000-0000-00000000a001');
  perform pg_temp.chk('U3 peruntukan berulang: already_confirmed, tiada kerusi kedua', o = 'already_confirmed' and pkg1c_t.enrolled(pg_temp.s('t1')) = 1, o);

  s := pkg1c_t.schedule('u3', 1);
  insert into t_reg values ('u3a', pkg1c_t.reg(s, 'u3a'), s);
  perform pkg1c_t.bill(pg_temp.r('u3a'), 'u3a');
  perform pkg1d_t.fail('u3a');
  perform pkg1c_t.expire_hold(pg_temp.r('u3a'));
  insert into t_reg values ('u3b', pkg1c_t.reg(s, 'u3b'), s);
  perform pkg1c_t.bill(pg_temp.r('u3b'), 'u3b');
  o := pkg1c_t.cb('u3b');
  perform pg_temp.chk('U3 persediaan: kerusi tunggal diambil (confirmed)', o = 'confirmed', o);
  o := pkg1c_t.cb('u3a');
  perform pg_temp.chk('U3 bayaran lewat ke sesi penuh: direkod, reconciliation_required', o = 'reconciliation_required' and pkg1d_t.att(pkg1d_t.bill_id('u3a')) = 'paid/TXN-u3a/100.00', o);
  o := pkg1c_t.retry(pg_temp.r('u3a'), '00000000-0000-0000-0000-00000000a001');
  perform pg_temp.chk('U3 admin memperuntukkan ke sesi penuh: paid_unallocated (pengawal kapasiti PKG-1c)', o = 'paid_unallocated', o);
  perform pg_temp.chk('U3 sesi penuh kekal 1/1', pkg1c_t.enrolled(s) = 1 and pkg1c_t.taken(s) = 1);
  update public.course_schedules set capacity = 2 where id = s;
  o := pkg1c_t.retry(pg_temp.r('u3a'), '00000000-0000-0000-0000-00000000a001');
  perform pg_temp.chk('U3 selepas kapasiti dinaikkan: confirmed, 2/2', o = 'confirmed' and pkg1c_t.enrolled(s) = 2, o);
end $$;

-- Global invariants.
select pg_temp.chk('Invarian: seats_taken = enrolmen aktif bagi setiap jadual sintetik',
  not exists (select 1 from public.course_schedules cs join public.courses c on c.id = cs.course_id
    where c.slug like 'synthetic-pkg1c-%' and cs.seats_taken <> pkg1c_t.enrolled(cs.id)));
select pg_temp.chk('Invarian: tiada jadual sintetik melebihi kapasiti',
  not exists (select 1 from public.course_schedules cs join public.courses c on c.id = cs.course_id
    where c.slug like 'synthetic-pkg1c-%' and c.slug not like 'synthetic-pkg1c-race%' and pkg1c_t.enrolled(cs.id) > cs.capacity));
select pg_temp.chk('Invarian: setiap rekod wang paid mempunyai txn atau pengesah bank, amaun disahkan sama dengan amaun',
  not exists (select 1 from public.public_registration_payments where status in ('paid', 'refunded')
    and (verified_amount is null or round(verified_amount, 2) <> round(amount, 2) or verified_at is null
      or (payment_provider = 'toyyibpay' and provider_transaction_id is null) or (payment_provider = 'bank_transfer' and provider_reference is null))));
select pg_temp.chk('Invarian: satu txn = satu rekod wang',
  not exists (select 1 from public.public_registration_payments where provider_transaction_id is not null group by payment_provider, provider_transaction_id having count(*) > 1));
select pg_temp.chk('Invarian: enrolmen bagi setiap pendaftaran tidak melebihi attendee_count',
  not exists (select 1 from t_reg t join public.public_registrations r on r.id = t.id where pkg1c_t.reg_enrolled(r.id) > r.attendee_count));
select pg_temp.chk('Invarian: tiada percubaan ToyyibPay terbuka pada pendaftaran yang paid',
  not exists (select 1 from public.public_registrations r join public.public_registration_payments p on p.registration_id = r.id
    where r.payment_status = 'paid' and p.payment_provider = 'toyyibpay' and p.status in ('pending', 'processing')));
select pg_temp.chk('Invarian: satu peserta paling banyak satu enrolmen aktif bagi setiap jadual',
  not exists (select 1 from public.schedule_participants where deleted_at is null and registration_status <> 'cancelled'
    group by schedule_id, participant_id having count(*) > 1));

-- U4: the existing staff queue filter (same predicate as reviewQueueLoader's paid_unconfirmed) finds every late payment.
select pg_temp.chk('U4 penapis "Paid, not confirmed" mengandungi setiap bayaran lewat yang belum diperuntukkan',
  (select count(*) from public.public_registrations where payment_status = 'paid' and registration_status <> 'confirmed'
     and id in (pg_temp.r('t2'), pg_temp.r('t4'), pg_temp.r('t12'), pg_temp.r('t12c'), pg_temp.r('t20b'))) = 5);

select 'QUEUE|' || t.k || '|' || json_build_object(
  'reg', json_build_object('id', r.id, 'registration_reference', r.registration_reference, 'created_at', r.created_at,
    'schedule_id', r.schedule_id, 'course_id', r.course_id, 'attendee_count', r.attendee_count,
    'amount_due_cents', round(r.amount_snapshot * 100)::int, 'registration_status', r.registration_status,
    'payment_status', r.payment_status, 'hold_expires_at', r.hold_expires_at),
  'payments', coalesce((select json_agg(json_build_object('id', p.id, 'registration_id', p.registration_id,
    'payment_provider', p.payment_provider, 'status', p.status, 'amount_cents', round(p.amount * 100)::int,
    'verified_cents', case when p.verified_amount is null then null else round(p.verified_amount * 100)::int end,
    'bill_creation_state', p.bill_creation_state, 'has_transaction_id', p.provider_transaction_id is not null,
    'callback_received', p.callback_received_at is not null)) from public.public_registration_payments p where p.registration_id = r.id), '[]'::json))::text
from t_reg t join public.public_registrations r on r.id = t.id
where t.k in ('t1', 't2', 't3', 't4', 't7', 't12', 't20b');

select 'RESULT|' || case when ok then 'PASS' else 'FAIL' end || '|' || name || '|' || replace(coalesce(detail, ''), E'\n', ' ') from t_results;
