-- Synthetic fixtures only. Executed by public-registration-positive-fee-db-contract.mts
-- against a disposable local PostgreSQL that holds Baseline V3 plus
-- 20261106090000_public_registration_positive_fee_only.sql. Never run elsewhere.

create temp table t_results (name text, ok boolean, detail text);

create function pg_temp.chk(p_name text, p_ok boolean, p_detail text default '') returns void
language sql as $$ insert into t_results values (p_name, coalesce(p_ok, false), p_detail) $$;

create function pg_temp.attendees(p_n integer) returns jsonb
language sql as $$
  select jsonb_agg(jsonb_build_object('full_name', 'SYNTHETIC Attendee ' || g, 'email', 'synthetic' || g || '@example.invalid'))
  from generate_series(1, p_n) g
$$;

create function pg_temp.secret(p_key text) returns text language sql as $$ select md5(p_key) || md5(p_key || 'x') $$;

create function pg_temp.try_create(p_schedule uuid, p_key text, p_n integer default 1) returns text
language plpgsql as $$
declare r jsonb;
begin
  r := public.create_public_registration(p_schedule, p_key, pg_temp.secret(p_key), pg_temp.attendees(p_n));
  return (r->>'status') || '|' || (r->>'amount');
exception when others then
  return 'ERR:' || sqlerrm;
end $$;

create function pg_temp.regs(p_schedule uuid) returns integer
language sql as $$ select count(*)::integer from public.public_registrations where schedule_id = p_schedule $$;

create function pg_temp.seats(p_schedule uuid) returns integer
language sql as $$ select available_seats from public.get_public_registration_schedule(p_schedule) $$;

create function pg_temp.avail(p_schedule uuid) returns text
language sql as $$
  select coalesce((select registration_available::text from public.get_public_registration_schedule(p_schedule)), 'no-row')
$$;

-- ---- fixtures -------------------------------------------------------------
insert into public.courses (title, course_name, slug, status) values
  ('SYNTHETIC Published Course', 'SYNTHETIC Published Course', 'synthetic-published-course', 'published'),
  ('SYNTHETIC Draft Course', 'SYNTHETIC Draft Course', 'synthetic-draft-course', 'draft');

create temp table t_s (k text primary key, id uuid);

create function pg_temp.mk(p_key text, p_fee numeric, p_status text default 'open', p_published boolean default true,
  p_capacity integer default 20, p_days integer default 30, p_course text default 'synthetic-published-course') returns void
language plpgsql as $$
declare v_id uuid;
begin
  insert into public.course_schedules (course_id, start_date, end_date, status, is_published, capacity, fee)
  values ((select id from public.courses where slug = p_course), current_date + p_days, current_date + p_days + 1,
          p_status::public.schedule_status, p_published, p_capacity, p_fee)
  returning id into v_id;
  insert into t_s values (p_key, v_id);
end $$;

select pg_temp.mk('null', null);
select pg_temp.mk('zero', 0);
select pg_temp.mk('min', 0.01);
select pg_temp.mk('pos', 1500);
select pg_temp.mk('dec', 1234.5);
select pg_temp.mk('full', 1500, 'full');
select pg_temp.mk('cancelled', 1500, 'cancelled');
select pg_temp.mk('past', 1500, 'open', true, 20, -5);
select pg_temp.mk('unpublished', 1500, 'open', false);
select pg_temp.mk('cap0', 1500, 'open', true, 0);
select pg_temp.mk('draftcourse', 1500, 'open', true, 20, 30, 'synthetic-draft-course');
select pg_temp.mk('cap1', 100, 'open', true, 1);
select pg_temp.mk('legacy', 800);

create function pg_temp.sid(p_key text) returns uuid language sql as $$ select id from t_s where k = p_key $$;

-- ---- get_public_registration_schedule: registration_available ---------------
select pg_temp.chk('schedule: fee NULL is not registrable', pg_temp.avail(pg_temp.sid('null')) = 'false', pg_temp.avail(pg_temp.sid('null')));
select pg_temp.chk('schedule: fee 0 is not registrable', pg_temp.avail(pg_temp.sid('zero')) = 'false', pg_temp.avail(pg_temp.sid('zero')));
select pg_temp.chk('schedule: minimum positive fee 0.01 is registrable', pg_temp.avail(pg_temp.sid('min')) = 'true', pg_temp.avail(pg_temp.sid('min')));
select pg_temp.chk('schedule: normal positive fee is registrable', pg_temp.avail(pg_temp.sid('pos')) = 'true', pg_temp.avail(pg_temp.sid('pos')));
select pg_temp.chk('schedule: decimal fee 1234.50 is registrable', pg_temp.avail(pg_temp.sid('dec')) = 'true', pg_temp.avail(pg_temp.sid('dec')));
select pg_temp.chk('schedule: full session is not registrable', pg_temp.avail(pg_temp.sid('full')) = 'false', pg_temp.avail(pg_temp.sid('full')));
select pg_temp.chk('schedule: cancelled (closed) session is not registrable', pg_temp.avail(pg_temp.sid('cancelled')) = 'false', pg_temp.avail(pg_temp.sid('cancelled')));
select pg_temp.chk('schedule: past session is not registrable', pg_temp.avail(pg_temp.sid('past')) = 'false', pg_temp.avail(pg_temp.sid('past')));
select pg_temp.chk('schedule: unpublished session returns no row', pg_temp.avail(pg_temp.sid('unpublished')) = 'no-row', pg_temp.avail(pg_temp.sid('unpublished')));
select pg_temp.chk('schedule: capacity 0 is not registrable', pg_temp.avail(pg_temp.sid('cap0')) = 'false', pg_temp.avail(pg_temp.sid('cap0')));
select pg_temp.chk('schedule: unpublished course returns no row', pg_temp.avail(pg_temp.sid('draftcourse')) = 'no-row', pg_temp.avail(pg_temp.sid('draftcourse')));
select pg_temp.chk('schedule: fee value and seats are still returned for a zero-fee session',
  (select fee = 0 and available_seats = 20 from public.get_public_registration_schedule(pg_temp.sid('zero'))));

-- ---- create_public_registration: rejected sessions never insert or hold seats --
do $$
declare k text; r text; before_seats integer;
begin
  foreach k in array array['null', 'zero', 'full', 'cancelled', 'past', 'unpublished', 'cap0', 'draftcourse'] loop
    before_seats := pg_temp.seats(pg_temp.sid(k));
    r := pg_temp.try_create(pg_temp.sid(k), 'synthetic-reject-key-' || k || '-0001');
    perform pg_temp.chk('create: ' || k || ' is rejected with schedule_unavailable', r = 'ERR:schedule_unavailable', r);
    perform pg_temp.chk('create: ' || k || ' inserts no registration', pg_temp.regs(pg_temp.sid(k)) = 0, pg_temp.regs(pg_temp.sid(k))::text);
    perform pg_temp.chk('create: ' || k || ' holds no seats',
      pg_temp.seats(pg_temp.sid(k)) is not distinct from before_seats, coalesce(pg_temp.seats(pg_temp.sid(k))::text, 'no-row'));
  end loop;
end $$;

do $$
declare msg text;
begin
  begin
    update public.course_schedules set fee = -1 where id = pg_temp.sid('pos');
    msg := 'no error';
  exception when check_violation then msg := 'check_violation'; end;
  perform pg_temp.chk('constraint: a negative fee is still rejected by the table check', msg = 'check_violation', msg);
end $$;

-- ---- create_public_registration: positive fees proceed ---------------------
do $$
declare r text; s uuid;
begin
  s := pg_temp.sid('min');
  r := pg_temp.try_create(s, 'synthetic-min-key-000000001', 2);
  perform pg_temp.chk('create: minimum positive fee 0.01 x 2 = 0.02', r = 'created|0.02', r);
  perform pg_temp.chk('create: positive fee holds the attendee seats', pg_temp.seats(s) = 18, pg_temp.seats(s)::text);

  s := pg_temp.sid('pos');
  r := pg_temp.try_create(s, 'synthetic-pos-key-000000001', 1);
  perform pg_temp.chk('create: normal positive fee 1500 x 1', r = 'created|1500.00', r);

  s := pg_temp.sid('dec');
  r := pg_temp.try_create(s, 'synthetic-dec-key-000000001', 3);
  perform pg_temp.chk('create: decimal fee 1234.50 x 3 = 3703.50', r = 'created|3703.50', r);

  -- idempotent retry: same key returns the existing registration, no second hold
  s := pg_temp.sid('pos');
  r := pg_temp.try_create(s, 'synthetic-pos-key-000000001', 1);
  perform pg_temp.chk('idempotency: retry returns already_exists', r = 'already_exists|1500.00', r);
  perform pg_temp.chk('idempotency: retry adds no registration', pg_temp.regs(s) = 1, pg_temp.regs(s)::text);
  perform pg_temp.chk('idempotency: retry holds no extra seat', pg_temp.seats(s) = 19, pg_temp.seats(s)::text);
end $$;

-- ---- existing capacity accounting is unchanged -----------------------------
do $$
declare r text; s uuid;
begin
  s := pg_temp.sid('cap1');
  r := pg_temp.try_create(s, 'synthetic-cap1-key-0000001', 1);
  perform pg_temp.chk('capacity: last seat can be taken at a positive fee', r = 'created|100.00', r);
  r := pg_temp.try_create(s, 'synthetic-cap1-key-0000002', 1);
  perform pg_temp.chk('capacity: a further registration is capacity_exceeded', r = 'ERR:capacity_exceeded', r);
  perform pg_temp.chk('capacity: schedule then reports no registration available', pg_temp.avail(s) = 'false', pg_temp.avail(s));
end $$;

-- ---- a registration made before a fee was set to 0 -------------------------
do $$
declare r text; s uuid;
begin
  s := pg_temp.sid('legacy');
  r := pg_temp.try_create(s, 'synthetic-legacy-key-000001', 1);
  perform pg_temp.chk('legacy: created while the fee was positive', r = 'created|800.00', r);
  update public.course_schedules set fee = 0 where id = s;
  r := pg_temp.try_create(s, 'synthetic-legacy-key-000001', 1);
  perform pg_temp.chk('legacy: retry of the existing registration still returns it', r = 'already_exists|800.00', r);
  r := pg_temp.try_create(s, 'synthetic-legacy-key-000002', 1);
  perform pg_temp.chk('legacy: a new registration on the now zero-fee session is rejected', r = 'ERR:schedule_unavailable', r);
  perform pg_temp.chk('legacy: only the original registration exists', pg_temp.regs(s) = 1, pg_temp.regs(s)::text);
end $$;

-- ---- payment setup is unchanged ---------------------------------------------
do $$
declare ref text; r jsonb; msg text; n integer; z_ref text; z_id uuid;
begin
  select registration_reference into ref from public.public_registrations where schedule_id = pg_temp.sid('pos');
  if ref is null then
    perform pg_temp.chk('payment: the positive-fee registration exists', false, 'no registration row');
    return;
  end if;
  r := public.begin_public_registration_payment(ref, pg_temp.secret('synthetic-pos-key-000000001'), 'toyyibpay');
  perform pg_temp.chk('payment: positive registration starts a payment attempt for 1500.00', (r->>'amount') = '1500.00', r::text);
  select count(*) into n from public.public_registration_payments pp
    join public.public_registrations pr on pr.id = pp.registration_id
    where pr.schedule_id = pg_temp.sid('pos') and pp.amount = 1500 and pp.status = 'pending';
  perform pg_temp.chk('payment: exactly one pending attempt with the positive amount', n = 1, n::text);

  -- Legacy data shape: a zero-amount registration inserted directly must still be refused at payment.
  insert into public.public_registrations (confirmation_token_hash, schedule_id, course_id, attendee_count,
    amount_snapshot, registration_status, payment_status, idempotency_key_hash, hold_expires_at)
  values (encode(extensions.digest(repeat('b', 64), 'sha256'), 'hex'), pg_temp.sid('zero'),
    (select course_id from public.course_schedules where id = pg_temp.sid('zero')), 1,
    0, 'pending_payment', 'pending', encode(extensions.digest('synthetic-zero-legacy-key', 'sha256'), 'hex'), now() + interval '30 minutes')
  returning registration_reference into z_ref;
  begin
    perform public.begin_public_registration_payment(z_ref, repeat('b', 64), 'toyyibpay');
    msg := 'no error';
  exception when others then msg := sqlerrm; end;
  perform pg_temp.chk('payment: a zero-amount registration is still refused', msg = 'zero_amount_registration', msg);
end $$;

-- ---- privileges are unchanged ----------------------------------------------
select pg_temp.chk('grants: create_public_registration executable by anon and authenticated, not PUBLIC',
  has_function_privilege('anon', 'public.create_public_registration(uuid,text,text,jsonb)', 'execute')
  and has_function_privilege('authenticated', 'public.create_public_registration(uuid,text,text,jsonb)', 'execute')
  and not has_function_privilege('public', 'public.create_public_registration(uuid,text,text,jsonb)', 'execute'));
select pg_temp.chk('grants: get_public_registration_schedule executable by anon and authenticated, not PUBLIC',
  has_function_privilege('anon', 'public.get_public_registration_schedule(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.get_public_registration_schedule(uuid)', 'execute')
  and not has_function_privilege('public', 'public.get_public_registration_schedule(uuid)', 'execute'));
select pg_temp.chk('contract: both functions stay SECURITY DEFINER with the expected search_path', (
  select bool_and(p.prosecdef) and bool_and(p.proconfig::text in ('{"search_path=pg_catalog, public, extensions"}', '{"search_path=pg_catalog, public"}'))
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('create_public_registration', 'get_public_registration_schedule')));

select 'RESULT|' || case when ok then 'PASS' else 'FAIL' end || '|' || name || '|' || coalesce(detail, '') from t_results;
