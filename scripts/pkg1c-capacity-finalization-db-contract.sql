-- Synthetic fixtures only. Executed by pkg1c-capacity-finalization-db-contract.mts against a disposable local
-- PostgreSQL that holds Baseline V3 + 20261106090000 + 20261122100000 (PKG-1) + 20261122110000 (PKG-1c).
-- Never run elsewhere. The runner executes the @@helpers section once (committed) and the @@checks section inside
-- BEGIN ... ROLLBACK, so the checks can be repeated against mutated function bodies on the same database.

-- @@helpers
create schema if not exists pkg1c_t;

-- Auth context for the SECURITY DEFINER functions (auth.role()/auth.uid() read these settings).
create or replace function pkg1c_t.ctx(p_role text, p_sub text default '') returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claim.role', p_role, false);
  perform set_config('request.jwt.claim.sub', p_sub, false);
  perform set_config('request.jwt.claims', json_build_object('role', p_role, 'sub', nullif(p_sub, ''))::text, false);
end $$;

create or replace function pkg1c_t.secret(p_key text) returns text language sql as $$ select md5(p_key) || md5(p_key || 'x') $$;

create or replace function pkg1c_t.attendees(p_key text, p_n integer) returns jsonb
language sql as $$
  select jsonb_agg(jsonb_build_object('full_name', 'SYNTHETIC PKG1C ' || p_key || ' ' || g,
    'ic_passport_no', 'SYN' || upper(substr(md5(p_key || g), 1, 9)), 'email', p_key || '-' || g || '@example.invalid'))
  from generate_series(1, p_n) g
$$;

create or replace function pkg1c_t.schedule(p_key text, p_capacity integer, p_fee numeric default 100) returns uuid
language plpgsql as $$
declare v_id uuid;
begin
  insert into public.courses (title, course_name, slug, status)
  values ('SYNTHETIC PKG1C ' || p_key, 'SYNTHETIC PKG1C ' || p_key, 'synthetic-pkg1c-' || p_key, 'published')
  on conflict do nothing;
  insert into public.course_schedules (course_id, start_date, end_date, status, is_published, capacity, fee)
  values ((select id from public.courses where slug = 'synthetic-pkg1c-' || p_key), current_date + 30, current_date + 31,
          'open'::public.schedule_status, true, p_capacity, p_fee)
  returning id into v_id;
  return v_id;
end $$;

-- Registration through the real create RPC (service_role, as the PKG-1b route does). Returns the registration id.
create or replace function pkg1c_t.reg(p_schedule uuid, p_key text, p_n integer default 1) returns uuid
language plpgsql as $$
declare v jsonb;
begin
  perform pkg1c_t.ctx('service_role');
  v := public.create_public_registration(p_schedule, 'pkg1c-idem-' || p_key || '-0001', pkg1c_t.secret(p_key), pkg1c_t.attendees(p_key, p_n));
  return (select id from public.public_registrations where registration_reference = v->>'registration_reference');
end $$;

-- ToyyibPay attempt through the real begin + attach RPCs: attempt becomes 'processing' with bill BILL-<key>.
create or replace function pkg1c_t.bill(p_reg uuid, p_key text) returns uuid
language plpgsql as $$
declare v_attempt uuid;
begin
  perform pkg1c_t.ctx('service_role');
  perform public.begin_public_registration_payment((select registration_reference from public.public_registrations where id = p_reg), pkg1c_t.secret(p_key));
  select id into v_attempt from public.public_registration_payments where registration_id = p_reg and payment_provider = 'toyyibpay';
  perform public.attach_public_registration_toyy_pay_bill(v_attempt, 'BILL-' || p_key, 'https://example.invalid/pay/' || p_key);
  return v_attempt;
end $$;

create or replace function pkg1c_t.expire_hold(p_reg uuid) returns void
language sql as $$ update public.public_registrations set hold_expires_at = now() - interval '1 minute' where id = p_reg $$;

-- Verified ToyyibPay callback (what the callback route calls after hash + server-to-server verification).
create or replace function pkg1c_t.cb(p_key text, p_amount numeric default null, p_txn text default null) returns text
language plpgsql as $$
declare v_attempt public.public_registration_payments%rowtype; r jsonb;
begin
  perform pkg1c_t.ctx('service_role');
  select * into v_attempt from public.public_registration_payments where provider_bill_code = 'BILL-' || p_key;
  r := public.finalize_public_registration_payment_from_callback(v_attempt.id, 'BILL-' || p_key,
    coalesce(p_amount, v_attempt.amount), coalesce(p_txn, 'TXN-' || p_key), now(), '{"synthetic":true}'::jsonb);
  return r->>'outcome';
exception when others then
  return 'ERR:' || sqlerrm;
end $$;

-- Staff-verified bank transfer (service_role caller with an explicit admin verifier, as an admin action would be).
create or replace function pkg1c_t.manual(p_reg uuid, p_key text, p_amount numeric default null) returns text
language plpgsql as $$
declare v_reg public.public_registrations%rowtype; r jsonb;
begin
  perform pkg1c_t.ctx('service_role');
  select * into v_reg from public.public_registrations where id = p_reg;
  r := public.verify_public_registration_manual_payment(v_reg.registration_reference, pkg1c_t.secret(p_key),
    coalesce(p_amount, v_reg.amount_snapshot), 'BANK-' || p_key, 'synthetic', '00000000-0000-0000-0000-00000000a001');
  return r->>'outcome';
exception when others then
  return 'ERR:' || sqlerrm;
end $$;

-- Staff retry of allocation as a signed-in user (authenticated + sub), or as service_role when p_sub is null.
create or replace function pkg1c_t.retry(p_reg uuid, p_sub text default null) returns text
language plpgsql as $$
declare r jsonb;
begin
  if p_sub is null then perform pkg1c_t.ctx('service_role'); else perform pkg1c_t.ctx('authenticated', p_sub); end if;
  r := public.finalize_public_registration_crm(p_reg);
  return r->>'outcome';
exception when others then
  return 'ERR:' || sqlstate || ':' || sqlerrm;
end $$;

create or replace function pkg1c_t.enrolled(p_schedule uuid) returns integer
language sql as $$
  select count(*)::integer from public.schedule_participants
  where schedule_id = p_schedule and deleted_at is null and registration_status <> 'cancelled'
$$;
create or replace function pkg1c_t.taken(p_schedule uuid) returns integer
language sql as $$ select seats_taken from public.course_schedules where id = p_schedule $$;
create or replace function pkg1c_t.reg_enrolled(p_reg uuid) returns integer
language sql as $$
  select count(*)::integer from public.public_registration_attendees a
  join public.public_registrations r on r.id = a.registration_id
  join public.schedule_participants sp on sp.participant_id = a.participant_id and sp.schedule_id = r.schedule_id
  where a.registration_id = p_reg and sp.deleted_at is null and sp.registration_status <> 'cancelled'
$$;
create or replace function pkg1c_t.state(p_reg uuid) returns text
language sql as $$
  select r.registration_status || '/' || r.payment_status || '/' || case when r.hold_expires_at is null then 'nohold' else 'hold' end
  from public.public_registrations r where r.id = p_reg
$$;
create or replace function pkg1c_t.attempt(p_key text) returns text
language sql as $$
  select status || '/' || coalesce(provider_transaction_id, '-') || '/' || coalesce(verified_amount::text, '-')
  from public.public_registration_payments where provider_bill_code = 'BILL-' || p_key
$$;

-- Synthetic admin (system actor and manual verifier) and editor.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a001', 'pkg1c-admin@example.invalid'),
  ('00000000-0000-0000-0000-00000000e001', 'pkg1c-editor@example.invalid')
on conflict do nothing;
insert into public.profiles (id, email, full_name, role, is_active) values
  ('00000000-0000-0000-0000-00000000a001', 'pkg1c-admin@example.invalid', 'SYNTHETIC Admin', 'admin', true),
  ('00000000-0000-0000-0000-00000000e001', 'pkg1c-editor@example.invalid', 'SYNTHETIC Editor', 'editor', true)
on conflict (id) do update set role = excluded.role, is_active = true, email = excluded.email;

-- @@checks
create temp table t_results (name text, ok boolean, detail text);
create function pg_temp.chk(p_name text, p_ok boolean, p_detail text default '') returns void
language sql as $$ insert into t_results values (p_name, coalesce(p_ok, false), coalesce(p_detail, '')) $$;
create temp table t_reg (k text primary key, id uuid, sched uuid);
create function pg_temp.r(p_key text) returns uuid language sql as $$ select id from t_reg where k = p_key $$;
create function pg_temp.s(p_key text) returns uuid language sql as $$ select sched from t_reg where k = p_key $$;

-- D1: on-time ToyyibPay payment, capacity exactly equal to the attendees (own hold must not count against itself).
do $$
declare s uuid; o text;
begin
  s := pkg1c_t.schedule('d1', 1);
  insert into t_reg values ('d1', pkg1c_t.reg(s, 'd1'), s);
  perform pkg1c_t.bill(pg_temp.r('d1'), 'd1');
  o := pkg1c_t.cb('d1');
  perform pg_temp.chk('D1 bayaran tepat masa, kapasiti tepat: confirmed', o = 'confirmed', o);
  perform pg_temp.chk('D1 status confirmed/paid, hold dikosongkan', pkg1c_t.state(pg_temp.r('d1')) = 'confirmed/paid/nohold', pkg1c_t.state(pg_temp.r('d1')));
  perform pg_temp.chk('D1 seats_taken = 1 = kapasiti', pkg1c_t.taken(s) = 1 and pkg1c_t.enrolled(s) = 1, pkg1c_t.taken(s)::text);
end $$;

-- D2: late ToyyibPay payment after the hold lapsed, seat still free -> confirmed.
do $$
declare s uuid; o text;
begin
  s := pkg1c_t.schedule('d2', 2);
  insert into t_reg values ('d2', pkg1c_t.reg(s, 'd2'), s);
  perform pkg1c_t.bill(pg_temp.r('d2'), 'd2');
  perform pkg1c_t.expire_hold(pg_temp.r('d2'));
  o := pkg1c_t.cb('d2');
  perform pg_temp.chk('D2 bayaran lewat, kerusi masih ada: confirmed', o = 'confirmed', o);
  perform pg_temp.chk('D2 seats_taken = 1', pkg1c_t.taken(s) = 1, pkg1c_t.taken(s)::text);
end $$;

-- D3: late ToyyibPay payment after the freed seat was taken by another paid registration -> paid_unallocated.
do $$
declare s uuid; o text; o2 text;
begin
  s := pkg1c_t.schedule('d3', 1);
  insert into t_reg values ('d3a', pkg1c_t.reg(s, 'd3a'), s);
  perform pkg1c_t.bill(pg_temp.r('d3a'), 'd3a');
  perform pkg1c_t.expire_hold(pg_temp.r('d3a'));
  insert into t_reg values ('d3b', pkg1c_t.reg(s, 'd3b'), s);
  perform pkg1c_t.bill(pg_temp.r('d3b'), 'd3b');
  o2 := pkg1c_t.cb('d3b');
  perform pg_temp.chk('D3 pendaftaran kedua mengambil kerusi yang dibebaskan: confirmed', o2 = 'confirmed', o2);
  o := pkg1c_t.cb('d3a');
  perform pg_temp.chk('D3 bayaran lewat, kerusi penuh: paid_unallocated (tiada raise)', o = 'paid_unallocated', o);
  perform pg_temp.chk('D3 percubaan bayaran direkod paid dengan txn dan amaun disahkan',
    pkg1c_t.attempt('d3a') = 'paid/TXN-d3a/100.00', pkg1c_t.attempt('d3a'));
  perform pg_temp.chk('D3 pendaftaran payment_pending/paid, hold dikosongkan',
    pkg1c_t.state(pg_temp.r('d3a')) = 'payment_pending/paid/nohold', pkg1c_t.state(pg_temp.r('d3a')));
  perform pg_temp.chk('D3 tiada peserta/enrolmen dicipta untuk pendaftaran lewat', pkg1c_t.reg_enrolled(pg_temp.r('d3a')) = 0
    and not exists (select 1 from public.public_registration_attendees where registration_id = pg_temp.r('d3a') and participant_id is not null));
  perform pg_temp.chk('D3 seats_taken = kapasiti (1), tidak melebihi', pkg1c_t.taken(s) = 1 and pkg1c_t.enrolled(s) = 1, pkg1c_t.taken(s)::text);
  perform pg_temp.chk('D3 jejak audit paid_unallocated direkod dengan butiran kapasiti',
    exists (select 1 from public.audit_logs where entity_type = 'public_registrations' and entity_id = pg_temp.r('d3a')::text
      and metadata->>'event' = 'paid_unallocated' and (metadata->>'capacity')::int = 1 and (metadata->>'used')::int = 1
      and (metadata->>'needed')::int = 1 and actor_id = '00000000-0000-0000-0000-00000000a001'));
  perform pg_temp.chk('D3 tiada audit "confirmed" untuk pendaftaran lewat',
    not exists (select 1 from public.audit_logs where entity_id = pg_temp.r('d3a')::text and summary like 'Public registration confirmed:%'));
end $$;

-- D3b: several attendees competing for limited seats.
do $$
declare s uuid; o text;
begin
  s := pkg1c_t.schedule('d3m', 3);
  insert into t_reg values ('d3m1', pkg1c_t.reg(s, 'd3m1', 2), s);
  perform pkg1c_t.bill(pg_temp.r('d3m1'), 'd3m1');
  perform pkg1c_t.expire_hold(pg_temp.r('d3m1'));
  insert into t_reg values ('d3m2', pkg1c_t.reg(s, 'd3m2', 2), s);
  perform pkg1c_t.bill(pg_temp.r('d3m2'), 'd3m2');
  o := pkg1c_t.cb('d3m2');
  perform pg_temp.chk('D3b 2 peserta (tepat masa): confirmed', o = 'confirmed', o);
  o := pkg1c_t.cb('d3m1');
  perform pg_temp.chk('D3b 2 peserta lewat, hanya 1 kerusi tinggal: paid_unallocated (tiada peruntukan separa)', o = 'paid_unallocated', o);
  perform pg_temp.chk('D3b tiada enrolmen separa untuk pendaftaran lewat', pkg1c_t.reg_enrolled(pg_temp.r('d3m1')) = 0);
  perform pg_temp.chk('D3b seats_taken = 2 <= 3', pkg1c_t.taken(s) = 2, pkg1c_t.taken(s)::text);
  perform pg_temp.chk('D11 tempat awam: pendaftaran paid_unallocated tidak memegang kerusi (available_seats = 1)',
    (select available_seats from public.get_public_registration_schedule(s)) = 1,
    (select available_seats::text from public.get_public_registration_schedule(s)));
  insert into t_reg values ('d3m3', pkg1c_t.reg(s, 'd3m3', 1), s);
  perform pkg1c_t.bill(pg_temp.r('d3m3'), 'd3m3');
  o := pkg1c_t.cb('d3m3');
  perform pg_temp.chk('D3b kerusi terakhir masih boleh didaftar dan disahkan: confirmed', o = 'confirmed', o);
  perform pg_temp.chk('D3b seats_taken = 3 = kapasiti', pkg1c_t.taken(s) = 3, pkg1c_t.taken(s)::text);
end $$;

-- D3c: a late payment must not take a seat that another unpaid registration still holds.
do $$
declare s uuid; o text;
begin
  s := pkg1c_t.schedule('d3h', 1);
  insert into t_reg values ('d3h1', pkg1c_t.reg(s, 'd3h1'), s);
  perform pkg1c_t.bill(pg_temp.r('d3h1'), 'd3h1');
  perform pkg1c_t.expire_hold(pg_temp.r('d3h1'));
  insert into t_reg values ('d3h2', pkg1c_t.reg(s, 'd3h2'), s);
  perform pkg1c_t.bill(pg_temp.r('d3h2'), 'd3h2');
  o := pkg1c_t.cb('d3h1');
  perform pg_temp.chk('D3c bayaran lewat ketika pegangan aktif orang lain: paid_unallocated', o = 'paid_unallocated', o);
  o := pkg1c_t.cb('d3h2');
  perform pg_temp.chk('D3c pemegang pegangan aktif tetap mendapat kerusi: confirmed', o = 'confirmed', o);
  perform pg_temp.chk('D3c seats_taken = 1', pkg1c_t.taken(s) = 1, pkg1c_t.taken(s)::text);
end $$;

-- D5: repeated callbacks never duplicate payments or allocations.
do $$
declare o text; before_sp integer; before_pay integer;
begin
  before_sp := (select count(*) from public.schedule_participants);
  before_pay := (select count(*) from public.public_registration_payments);
  o := pkg1c_t.cb('d1');
  perform pg_temp.chk('D5 callback berulang (confirmed): duplicate_ignored', o = 'duplicate_ignored', o);
  o := pkg1c_t.cb('d3a');
  perform pg_temp.chk('D5 callback berulang (paid_unallocated): duplicate_ignored', o = 'duplicate_ignored', o);
  o := pkg1c_t.cb('d3a', null, 'TXN-OTHER-d3a');
  perform pg_temp.chk('D5 txn lain pada percubaan paid: paid_attempt_conflict', o like 'ERR:paid_attempt_conflict%', o);
  perform pg_temp.chk('D5 tiada enrolmen atau bayaran baharu', (select count(*) from public.schedule_participants) = before_sp
    and (select count(*) from public.public_registration_payments) = before_pay);
  perform pg_temp.chk('D5 tepat satu percubaan paid bagi setiap pendaftaran', not exists (
    select 1 from public.public_registration_payments where status = 'paid' group by registration_id having count(*) > 1));
end $$;

-- D6: incorrect amount is rejected without any change.
do $$
declare s uuid; o text;
begin
  s := pkg1c_t.schedule('d6', 5);
  insert into t_reg values ('d6', pkg1c_t.reg(s, 'd6'), s);
  perform pkg1c_t.bill(pg_temp.r('d6'), 'd6');
  o := pkg1c_t.cb('d6', 99.99);
  perform pg_temp.chk('D6 amaun salah: payment_amount_mismatch', o like 'ERR:payment_amount_mismatch%', o);
  perform pg_temp.chk('D6 percubaan kekal processing, tiada txn', pkg1c_t.attempt('d6') = 'processing/-/-', pkg1c_t.attempt('d6'));
  perform pg_temp.chk('D6 pendaftaran tidak berubah, tiada enrolmen', pkg1c_t.state(pg_temp.r('d6')) = 'payment_pending/processing/hold'
    and pkg1c_t.enrolled(s) = 0, pkg1c_t.state(pg_temp.r('d6')));
end $$;

-- D7: verified payment after the registration was cancelled / expired (attempt still processing).
do $$
declare s uuid; o text;
begin
  s := pkg1c_t.schedule('d7', 5);
  insert into t_reg values ('d7c', pkg1c_t.reg(s, 'd7c'), s);
  perform pkg1c_t.bill(pg_temp.r('d7c'), 'd7c');
  update public.public_registrations set registration_status = 'cancelled' where id = pg_temp.r('d7c');
  o := pkg1c_t.cb('d7c');
  perform pg_temp.chk('D7 bayaran selepas pembatalan: reconciliation_required', o = 'reconciliation_required', o);
  perform pg_temp.chk('D7 percubaan direkod paid (bayaran tidak dibuang)', pkg1c_t.attempt('d7c') = 'paid/TXN-d7c/100.00', pkg1c_t.attempt('d7c'));
  perform pg_temp.chk('D7 pendaftaran kekal cancelled, payment_status paid', pkg1c_t.state(pg_temp.r('d7c')) like 'cancelled/paid/%', pkg1c_t.state(pg_temp.r('d7c')));
  perform pg_temp.chk('D7 tiada kerusi diperuntukkan', pkg1c_t.enrolled(s) = 0 and pkg1c_t.taken(s) = 0);
  perform pg_temp.chk('D7 bendera rekonsiliasi dan acara late_success_after_expiry direkod',
    (select (raw_response->>'late_success_reconciliation_required')::boolean from public.public_registration_payments where provider_bill_code = 'BILL-d7c')
    and exists (select 1 from public.audit_logs where entity_type = 'public_registration_payments'
      and summary = 'Public registration payment event: late_success_after_expiry' and metadata->>'attempt_recorded_paid' = 'true'));
  o := pkg1c_t.cb('d7c');
  perform pg_temp.chk('D7 callback berulang selepas pembatalan: duplicate_ignored', o = 'duplicate_ignored', o);
  o := pkg1c_t.retry(pg_temp.r('d7c'));
  perform pg_temp.chk('D7 pendaftaran cancelled tidak boleh diperuntukkan', o like 'ERR:P0001:registration_not_finalizable%', o);

  insert into t_reg values ('d7e', pkg1c_t.reg(s, 'd7e'), s);
  perform pkg1c_t.bill(pg_temp.r('d7e'), 'd7e');
  update public.public_registrations set registration_status = 'expired' where id = pg_temp.r('d7e');
  o := pkg1c_t.cb('d7e');
  perform pg_temp.chk('D7 bayaran selepas expired: reconciliation_required + attempt paid',
    o = 'reconciliation_required' and pkg1c_t.attempt('d7e') = 'paid/TXN-d7e/100.00', o || ' ' || pkg1c_t.attempt('d7e'));
  perform pg_temp.chk('D7 expired kekal expired, payment_status paid', pkg1c_t.state(pg_temp.r('d7e')) like 'expired/paid/%', pkg1c_t.state(pg_temp.r('d7e')));
end $$;

-- D8: attempt already cancelled (e.g. by expire_public_registrations) keeps the previous reconciliation record.
do $$
declare s uuid; o text;
begin
  s := pkg1c_t.schedule('d8', 5);
  insert into t_reg values ('d8', pkg1c_t.reg(s, 'd8'), s);
  perform pkg1c_t.bill(pg_temp.r('d8'), 'd8');
  perform pkg1c_t.expire_hold(pg_temp.r('d8'));
  perform pkg1c_t.ctx('service_role');
  perform public.expire_public_registrations();
  perform pg_temp.chk('D8 expire_public_registrations membatalkan percubaan', pkg1c_t.attempt('d8') = 'cancelled/-/-', pkg1c_t.attempt('d8'));
  o := pkg1c_t.cb('d8');
  perform pg_temp.chk('D8 bayaran lewat pada percubaan cancelled: reconciliation_required', o = 'reconciliation_required', o);
  perform pg_temp.chk('D8 percubaan kekal cancelled, txn dan bendera rekonsiliasi direkod',
    pkg1c_t.attempt('d8') = 'cancelled/TXN-d8/-'
    and (select (raw_response->>'late_success_reconciliation_required')::boolean from public.public_registration_payments where provider_bill_code = 'BILL-d8'),
    pkg1c_t.attempt('d8'));
  perform pg_temp.chk('D8 tiada kerusi diperuntukkan', pkg1c_t.enrolled(s) = 0);
end $$;

-- D9: staff retry after capacity is freed or increased; non-admin cannot retry; no override while full.
do $$
declare o text;
begin
  o := pkg1c_t.retry(pg_temp.r('d3a'), '00000000-0000-0000-0000-00000000a001');
  perform pg_temp.chk('D9 cuba semula oleh admin semasa masih penuh: paid_unallocated', o = 'paid_unallocated', o);
  perform pg_temp.chk('D9 seats_taken kekal 1', pkg1c_t.taken(pg_temp.s('d3a')) = 1);
  o := pkg1c_t.retry(pg_temp.r('d3a'), '00000000-0000-0000-0000-00000000e001');
  perform pg_temp.chk('D9 editor tidak boleh cuba semula: 42501', o like 'ERR:42501:%', o);
  update public.course_schedules set capacity = 2 where id = pg_temp.s('d3a');
  o := pkg1c_t.retry(pg_temp.r('d3a'), '00000000-0000-0000-0000-00000000a001');
  perform pg_temp.chk('D9 selepas kapasiti dinaikkan: confirmed', o = 'confirmed', o);
  perform pg_temp.chk('D9 seats_taken = 2 = kapasiti baharu', pkg1c_t.taken(pg_temp.s('d3a')) = 2);
  o := pkg1c_t.retry(pg_temp.r('d3a'), '00000000-0000-0000-0000-00000000a001');
  perform pg_temp.chk('D9 cuba semula selepas confirmed: already_confirmed (tiada peruntukan berganda)', o = 'already_confirmed' and pkg1c_t.taken(pg_temp.s('d3a')) = 2, o);
end $$;

-- D9b: staff-confirmed manual bank transfer goes through the same capacity guard.
do $$
declare s uuid; o text;
begin
  s := pkg1c_t.schedule('dm', 1);
  insert into t_reg values ('dm1', pkg1c_t.reg(s, 'dm1'), s);
  perform pkg1c_t.expire_hold(pg_temp.r('dm1'));
  insert into t_reg values ('dm2', pkg1c_t.reg(s, 'dm2'), s);
  o := pkg1c_t.manual(pg_temp.r('dm2'), 'dm2');
  perform pg_temp.chk('D9b pindahan bank manual dalam kapasiti: confirmed', o = 'confirmed', o);
  o := pkg1c_t.manual(pg_temp.r('dm1'), 'dm1', 50);
  perform pg_temp.chk('D9b pindahan bank amaun salah: manual_payment_amount_mismatch', o like 'ERR:manual_payment_amount_mismatch%', o);
  o := pkg1c_t.manual(pg_temp.r('dm1'), 'dm1');
  perform pg_temp.chk('D9b pindahan bank lewat, kerusi penuh: paid_unallocated', o = 'paid_unallocated', o);
  perform pg_temp.chk('D9b percubaan bank_transfer direkod paid', (select status from public.public_registration_payments
    where registration_id = pg_temp.r('dm1') and payment_provider = 'bank_transfer') = 'paid');
  perform pg_temp.chk('D9b pendaftaran payment_pending/paid/nohold', pkg1c_t.state(pg_temp.r('dm1')) = 'payment_pending/paid/nohold', pkg1c_t.state(pg_temp.r('dm1')));
  o := pkg1c_t.manual(pg_temp.r('dm1'), 'dm1');
  perform pg_temp.chk('D9b pengesahan manual berulang: already_paid, tiada bayaran kedua',
    o = 'already_paid' and (select count(*) from public.public_registration_payments where registration_id = pg_temp.r('dm1')) = 1, o);
  perform pg_temp.chk('D9b seats_taken = 1 = kapasiti', pkg1c_t.taken(s) = 1 and pkg1c_t.enrolled(s) = 1);
end $$;

-- D10: payer-facing status for a paid-but-unallocated registration (D3b's d3m1 is still unallocated).
do $$
declare v_status text; v_pay text;
begin
  select registration_status, payment_status into v_status, v_pay
  from public.get_public_registration_status((select registration_reference from public.public_registrations where id = pg_temp.r('d3m1')), pkg1c_t.secret('d3m1'));
  perform pg_temp.chk('D10 status pembayar: payment_pending/paid (bukan expired, bukan confirmed)',
    v_status = 'payment_pending' and v_pay = 'paid', coalesce(v_status, 'null') || '/' || coalesce(v_pay, 'null'));
end $$;

-- Transaction rollback: a finalization failure after the payment update rolls the whole callback back.
do $$
declare s uuid; o text;
begin
  s := pkg1c_t.schedule('drb', 5);
  insert into t_reg values ('drb', pkg1c_t.reg(s, 'drb'), s);
  perform pkg1c_t.bill(pg_temp.r('drb'), 'drb');
  update public.course_schedules set status = 'cancelled'::public.schedule_status where id = s;
  o := pkg1c_t.cb('drb');
  perform pg_temp.chk('Rollback: jadual dibatalkan -> schedule_not_finalizable', o like 'ERR:schedule_not_finalizable%', o);
  perform pg_temp.chk('Rollback: percubaan kekal processing tanpa txn (tiada tulisan separa)', pkg1c_t.attempt('drb') = 'processing/-/-', pkg1c_t.attempt('drb'));
  perform pg_temp.chk('Rollback: pendaftaran tidak berubah', pkg1c_t.state(pg_temp.r('drb')) = 'payment_pending/processing/hold', pkg1c_t.state(pg_temp.r('drb')));
end $$;

-- Duplicate-registration prevention (existing rule, regression).
do $$
declare s uuid; msg text;
begin
  s := pg_temp.s('d6');
  begin
    perform pkg1c_t.ctx('service_role');
    perform public.create_public_registration(s, 'pkg1c-idem-dup-0000001', pkg1c_t.secret('dup'), pkg1c_t.attendees('d6', 1));
    msg := 'created';
  exception when others then msg := sqlerrm; end;
  perform pg_temp.chk('Pendua: peserta yang sama tidak boleh didaftar dua kali pada sesi yang sama', msg like '%duplicate%', msg);
  perform pg_temp.chk('Pendua: kunci idempoten yang sama memulangkan pendaftaran sedia ada',
    (public.create_public_registration(s, 'pkg1c-idem-d6-0001', pkg1c_t.secret('d6'), pkg1c_t.attendees('d6', 1)))->>'registration_reference'
      = (select registration_reference from public.public_registrations where id = pg_temp.r('d6')));
end $$;

-- Global invariants after every scenario.
select pg_temp.chk('Invarian: seats_taken = enrolmen aktif bagi setiap jadual sintetik',
  not exists (select 1 from public.course_schedules cs join public.courses c on c.id = cs.course_id
    where c.slug like 'synthetic-pkg1c-%' and cs.seats_taken <> pkg1c_t.enrolled(cs.id)));
select pg_temp.chk('Invarian: tiada jadual sintetik melebihi kapasiti',
  not exists (select 1 from public.course_schedules cs join public.courses c on c.id = cs.course_id
    where c.slug like 'synthetic-pkg1c-%' and c.slug not like 'synthetic-pkg1c-race%' and pkg1c_t.enrolled(cs.id) > cs.capacity));
select pg_temp.chk('Invarian: setiap percubaan berjaya (txn disahkan) wujud dan tiada yang hilang',
  (select count(*) from public.public_registration_payments where provider_transaction_id like 'TXN-%') =
  (select count(*) from public.public_registration_payments where provider_transaction_id like 'TXN-%' and (status = 'paid' or raw_response ? 'late_success_reconciliation_required')));
select pg_temp.chk('Invarian: satu peserta paling banyak satu enrolmen aktif bagi setiap jadual',
  not exists (select 1 from public.schedule_participants where deleted_at is null and registration_status <> 'cancelled'
    group by schedule_id, participant_id having count(*) > 1));

-- Staff queue (same predicate as reviewQueueLoader's paid_unconfirmed filter).
select pg_temp.chk('Baris gilir staf: penapis "Paid, not confirmed" mengandungi semua kes paid-unallocated dan paid-after-ended',
  (select count(*) from public.public_registrations where payment_status = 'paid' and registration_status <> 'confirmed'
     and id in (pg_temp.r('d3m1'), pg_temp.r('d3h1'), pg_temp.r('dm1'), pg_temp.r('d7c'), pg_temp.r('d7e'))) = 5);

-- Rows for the TypeScript review-queue classification (read by the runner).
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
where t.k in ('d3m1', 'd3h1', 'dm1', 'd7c', 'd7e', 'd1', 'd3m2');

select 'RESULT|' || case when ok then 'PASS' else 'FAIL' end || '|' || name || '|' || replace(coalesce(detail, ''), E'\n', ' ') from t_results;
