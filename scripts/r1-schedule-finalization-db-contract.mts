import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";

// R1 (A5) contract: a verified payment is never rolled back because its course schedule is cancelled, completed or
// missing. Runs against an isolated, disposable local PostgreSQL (the Supabase Postgres image) bootstrapped from
// Baseline V3 + 20261106090000 + PKG-1 + PKG-1c + PKG-1d-A. It never connects to Supabase, Staging, Production or
// ToyyibPay, uses synthetic fixtures only, and removes its container on exit.
//
// Covers: the pre-fix defect proof; R1-1..R1-8 functional checks; R1-9 privileges, owner, SECURITY DEFINER,
// search_path and signatures; R1-5 concurrency with genuinely simultaneous committed sessions; R1-10 negative
// mutations (each applied, then caught); R1-11 forward rollback and re-apply; R1-12 the unchanged PKG-1c and PKG-1d-A
// checks re-run on top of A5 with exactly the named intentional changes.
const root = new URL("..", import.meta.url);
const image = "public.ecr.aws/supabase/postgres:17.6.1.166";
const container = `teras-r1-db-${process.pid}`;
const predecessors = [
  "supabase/migrations/20261106090000_public_registration_positive_fee_only.sql",
  "supabase/migrations/20261122100000_revoke_public_execute_registration_rpcs.sql",
  "supabase/migrations/20261122110000_public_registration_capacity_safe_finalization.sql",
  "supabase/migrations/20261122120000_public_registration_payment_guard_late_success.sql",
  "supabase/migrations/20261122121000_public_registration_late_success_recording.sql",
  "supabase/migrations/20261122122000_public_registration_manual_payment_states.sql",
  "supabase/migrations/20261122123000_public_registration_begin_payment_paid_guard.sql",
];
const A5 = "supabase/migrations/20261122124000_public_registration_schedule_finalizable_guard.sql";
const FN = {
  cb: "public.finalize_public_registration_payment_from_callback(uuid,text,numeric,text,timestamptz,jsonb)",
  verify: "public.verify_public_registration_manual_payment(text,text,numeric,text,text,uuid)",
  crm: "public.finalize_public_registration_crm(uuid)",
} as const;
// Live on Staging after PKG-1d-A (22 Nov 2026).
const PINNED = { cb: "9e6a173e5e58c216dced5d32b2bd503a", verify: "0cdbb4fe6fbf9e81f0dded545ca7c30e", crm: "fe568112a7c9a2ae8ad765557dc5f8c6" };
const LIVE_GRANTEES = { cb: "postgres,service_role", verify: "authenticated,postgres,service_role", crm: "authenticated,postgres,service_role" };
const CONFIG = { cb: "true:search_path=pg_catalog, public, app", verify: "true:search_path=pg_catalog, public, app, extensions",
  crm: "true:search_path=pg_catalog, public, app, extensions" };
// PKG-1c checks whose behaviour changes on purpose: D6/D8 (PKG-1d-A, already superseded) and the PKG-1c "rollback on a
// cancelled schedule" block, which is exactly the R1 defect A5 removes.
const PKG1C_SUPERSEDED = [
  "D6 amaun salah: payment_amount_mismatch",
  "D8 percubaan kekal cancelled, txn dan bendera rekonsiliasi direkod",
  "Rollback: jadual dibatalkan -> schedule_not_finalizable",
  "Rollback: percubaan kekal processing tanpa txn (tiada tulisan separa)",
  "Rollback: pendaftaran tidak berubah",
];

if (process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || process.env.SUPABASE_URL) {
  throw new Error("Refusing database test: external database environment variables are set");
}

const docker = (args: string[], input?: string): string => execFileSync("docker", args, {
  cwd: root, input, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
  stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"], env: { ...process.env, MSYS_NO_PATHCONV: "1" },
});
const PSQL = ["exec", "-i", container, "psql", "-v", "ON_ERROR_STOP=1", "-qAt", "-U", "supabase_admin", "-h", "127.0.0.1", "-d", "postgres"];
const psql = (sql: string): string => {
  try { return docker(PSQL, sql); } catch (error) {
    const details = error as { stdout?: string; stderr?: string };
    throw new Error(`${details.stdout ?? ""}${details.stderr ?? ""}`);
  }
};
// A concurrent psql session; always resolves (never rejects), so container clean-up can never be skipped.
const session = (sql: string): Promise<{ out: string; ms: number }> => new Promise((resolve) => {
  const started = Date.now();
  const child = spawn("docker", PSQL, { cwd: root, env: { ...process.env, MSYS_NO_PATHCONV: "1" } });
  let out = "";
  let err = "";
  child.stdout.on("data", (d) => { out += d; });
  child.stderr.on("data", (d) => { err += d; });
  child.on("close", (code) => resolve({ out: code === 0 ? out : `ERR:${(err || out).split("\n")[0]}`, ms: Date.now() - started }));
  child.on("error", (error) => resolve({ out: `ERR:${error.message}`, ms: Date.now() - started }));
  child.stdin.end(sql);
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const read = (path: string) => readFileSync(new URL(path, root), "utf8").replace(/\r\n/g, "\n");
const section = (sql: string, from: string, to?: string) => sql.slice(sql.indexOf(from), to ? sql.indexOf(to) : undefined);

const pkg1cSql = read("scripts/pkg1c-capacity-finalization-db-contract.sql");
const pkg1dSql = read("scripts/pkg1d-a-payment-integrity-db-contract.sql");
const pkg1cHelpers = section(pkg1cSql, "-- @@helpers", "-- @@checks");
const pkg1cChecks = section(pkg1cSql, "-- @@checks");
const pkg1dHelpers = section(pkg1dSql, "-- @@helpers", "-- @@checks");
const pkg1dChecks = section(pkg1dSql, "-- @@checks");
const a5Sql = read(A5);

let failures = 0;
const report = (ok: boolean, name: string, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "LULUS" : "GAGAL"} ${name}${detail && !ok ? ` -> ${detail}` : ""}`);
};

const md5 = (fn: string) => psql(`select md5(regexp_replace(pg_get_functiondef('${fn}'::regprocedure), '\\s+', '', 'g'));`).trim();
const md5s = () => Object.fromEntries(Object.entries(FN).map(([k, fn]) => [k, md5(fn)])) as Record<keyof typeof FN, string>;
const grantees = (fn: string) => psql(`select string_agg(distinct a.grantee::regrole::text, ',' order by a.grantee::regrole::text)
  from pg_proc p, lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  where p.oid = '${fn}'::regprocedure and a.privilege_type = 'EXECUTE';`).trim();
const grants = () => Object.fromEntries(Object.entries(FN).map(([k, fn]) => [k, grantees(fn)])) as Record<keyof typeof FN, string>;
const config = (fn: string) => psql(`select prosecdef::text || ':' || coalesce(array_to_string(proconfig, ','), '') from pg_proc where oid = '${fn}'::regprocedure;`).trim();
const owner = (fn: string) => psql(`select proowner::regrole::text from pg_proc where oid = '${fn}'::regprocedure;`).trim();
const signatures = () => psql(`select string_agg(p.oid::regprocedure::text || '->' || pg_get_function_result(p.oid), ';' order by 1)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
  and p.proname in ('finalize_public_registration_payment_from_callback', 'verify_public_registration_manual_payment', 'finalize_public_registration_crm');`).trim();
const otherBodies = () => psql(`select string_agg(p.oid::regprocedure::text || '=' || md5(regexp_replace(pg_get_functiondef(p.oid), '\\s+', '', 'g')), ';' order by p.oid::regprocedure::text)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where ((n.nspname = 'public' and (p.proname like '%public_registration%' or p.proname in ('log_event_as_service')))
     or (n.nspname = 'app' and p.proname in ('sync_schedule_seats', 'public_registration_state_guard', 'public_registration_payment_state_guard',
       'toyyibpay_system_actor', 'is_admin', 'audit_trigger')))
    and p.oid not in ('${FN.cb}'::regprocedure, '${FN.verify}'::regprocedure);`).trim();

interface Run { results: { ok: boolean; name: string; detail: string }[] }
const runChecks = (checks: string): Run => {
  let out: string;
  try { out = psql(`begin;\n${checks}\nrollback;\n`); } catch (error) {
    return { results: [{ ok: false, name: "pelaksanaan semakan SQL", detail: (error as Error).message.split("\n")[0] }] };
  }
  const results: Run["results"] = [];
  for (const line of out.split("\n")) {
    const m = /^RESULT\|(PASS|FAIL)\|([^|]*)\|(.*)$/.exec(line.trim());
    if (m) results.push({ ok: m[1] === "PASS", name: m[2], detail: m[3] });
  }
  return { results };
};
const failedNames = (run: Run) => run.results.filter((r) => !r.ok).map((r) => r.name);

// The R1 functional checks (R1-1..R1-4, R1-6..R1-8 and the related invariants), run inside BEGIN ... ROLLBACK.
const R1_CHECKS = `
create temp table t_results (ord serial, name text, ok boolean, detail text);
create function pg_temp.chk(p_name text, p_ok boolean, p_detail text default '') returns void
language sql as $$ insert into t_results (name, ok, detail) values (p_name, coalesce(p_ok, false), coalesce(p_detail, '')) $$;
create temp table t_reg (k text primary key, id uuid, sched uuid);
create function pg_temp.r(p_key text) returns uuid language sql as $$ select id from t_reg where k = p_key $$;
-- The callback with its full JSON result (pkg1c_t.cb returns only the outcome).
create function pg_temp.cbj(p_key text, p_txn text default null) returns text language plpgsql as $$
declare v_attempt public.public_registration_payments%rowtype; r jsonb;
begin
  perform pkg1c_t.ctx('service_role');
  select * into v_attempt from public.public_registration_payments where provider_bill_code = 'BILL-' || p_key;
  r := public.finalize_public_registration_payment_from_callback(v_attempt.id, 'BILL-' || p_key, v_attempt.amount,
    coalesce(p_txn, 'TXN-' || p_key), now(), '{"synthetic":true}'::jsonb);
  return (r->>'outcome') || '|' || coalesce(r->>'reason', '-');
exception when others then return 'ERR:' || sqlerrm;
end $$;
create function pg_temp.r1events(p_attempt uuid) returns integer language sql as $$
  select count(*)::integer from public.audit_logs where entity_id = $1::text and metadata->>'event' = 'schedule_not_finalizable_recorded' $$;
create function pg_temp.cancel(p_schedule uuid, p_status text) returns void language sql as $$
  update public.course_schedules set status = p_status::public.schedule_status where id = p_schedule $$;

-- R1-1: normal successful payment, open schedule: unchanged PKG-1c behaviour.
do $$ declare s uuid; o text; a uuid; begin
  s := pkg1c_t.schedule('r1n', 5);
  insert into t_reg values ('r1n', pkg1c_t.reg(s, 'r1n'), s);
  a := pkg1c_t.bill(pg_temp.r('r1n'), 'r1n');
  o := pg_temp.cbj('r1n');
  perform pg_temp.chk('R1-1 bayaran biasa (jadual open): confirmed', o = 'confirmed|-', o);
  perform pg_temp.chk('R1-1 confirmed/paid, satu kerusi, percubaan paid', pkg1c_t.state(pg_temp.r('r1n')) = 'confirmed/paid/nohold'
    and pkg1c_t.enrolled(s) = 1 and pkg1d_t.att(a) = 'paid/TXN-r1n/100.00', pkg1c_t.state(pg_temp.r('r1n')));
  perform pg_temp.chk('R1-1 tiada acara schedule_not_finalizable_recorded', pg_temp.r1events(a) = 0);
end $$;

-- R1-2 / R1-3: successful payment after the schedule was cancelled / completed.
do $$ declare s uuid; o text; a uuid; st text; k text; begin
  foreach st in array array['cancelled', 'completed'] loop
    k := 'r1' || left(st, 2);
    s := pkg1c_t.schedule(k, 5);
    insert into t_reg values (k, pkg1c_t.reg(s, k), s);
    a := pkg1c_t.bill(pg_temp.r(k), k);
    perform pg_temp.cancel(s, st);
    o := pg_temp.cbj(k);
    perform pg_temp.chk('R1-' || case when st = 'cancelled' then '2' else '3' end || ' jadual ' || st || ': reconciliation_required (schedule_not_finalizable)',
      o = 'reconciliation_required|schedule_not_finalizable', o);
    perform pg_temp.chk('R1-' || case when st = 'cancelled' then '2' else '3' end || ' bayaran kekal: percubaan paid dengan txn dan amaun',
      pkg1d_t.att(a) = 'paid/TXN-' || k || '/100.00', pkg1d_t.att(a));
    perform pg_temp.chk('R1-' || case when st = 'cancelled' then '2' else '3' end || ' pendaftaran payment_pending/paid, hold dilepaskan, status pendaftaran tidak berubah',
      pkg1c_t.state(pg_temp.r(k)) = 'payment_pending/paid/nohold', pkg1c_t.state(pg_temp.r(k)));
    perform pg_temp.chk('R1-' || case when st = 'cancelled' then '2' else '3' end || ' tiada kerusi, peserta atau enrolmen',
      pkg1c_t.enrolled(s) = 0 and pkg1c_t.reg_enrolled(pg_temp.r(k)) = 0
      and not exists (select 1 from public.public_registration_attendees where registration_id = pg_temp.r(k) and participant_id is not null));
    perform pg_temp.chk('R1-' || case when st = 'cancelled' then '2' else '3' end || ' bukti schedule_not_finalizable.schedule_status = ' || st,
      (select raw_response->'schedule_not_finalizable'->>'schedule_status' from public.public_registration_payments where id = a) = st);
    perform pg_temp.chk('R1-' || case when st = 'cancelled' then '2' else '3' end || ' tepat satu audit dengan txn, amaun dan seat_allocated=false',
      pg_temp.r1events(a) = 1 and exists (select 1 from public.audit_logs where entity_id = a::text and metadata->>'event' = 'schedule_not_finalizable_recorded'
        and metadata->>'provider_transaction_id' = 'TXN-' || k and (metadata->>'verified_amount')::numeric = 100
        and metadata->>'schedule_status' = st and metadata->>'seat_allocated' = 'false'), pg_temp.r1events(a)::text);
    perform pg_temp.chk('R1-' || case when st = 'cancelled' then '2' else '3' end || ' jadual dan kapasiti tidak berubah oleh callback',
      (select status::text from public.course_schedules where id = s) = st and pkg1c_t.taken(s) = 0);
  end loop;
end $$;

-- R1-2b: expiry afterwards leaves the reconciled registration alone (no hold left to expire).
do $$ declare n integer; begin
  perform pkg1c_t.ctx('service_role');
  n := public.expire_public_registrations();
  perform pg_temp.chk('R1-2b expire_public_registrations tidak menamatkan pendaftaran yang disimpan untuk rekonsiliasi',
    pkg1c_t.state(pg_temp.r('r1ca')) = 'payment_pending/paid/nohold' and pkg1d_t.att(pkg1d_t.bill_id('r1ca')) = 'paid/TXN-r1ca/100.00',
    pkg1c_t.state(pg_temp.r('r1ca')));
end $$;

-- R1-4: replay of the same verified transaction, and a different transaction on the paid attempt.
do $$ declare o text; a uuid := pkg1d_t.bill_id('r1ca'); begin
  o := pg_temp.cbj('r1ca');
  perform pg_temp.chk('R1-4 ulangan txn sama: duplicate_ignored', o = 'duplicate_ignored|-', o);
  perform pg_temp.chk('R1-4 ulangan: satu rekod wang, satu audit, tiada kerusi',
    (select count(*) from public.public_registration_payments where provider_transaction_id = 'TXN-r1ca') = 1
    and pg_temp.r1events(a) = 1 and pkg1c_t.reg_enrolled(pg_temp.r('r1ca')) = 0);
  o := pg_temp.cbj('r1ca', 'TXN-r1ca-OTHER');
  perform pg_temp.chk('R1-4 txn berbeza pada percubaan paid: paid_attempt_conflict (raise)', o like 'ERR:paid_attempt_conflict%', o);
  perform pg_temp.chk('R1-4 txn asal kekal, tiada audit tambahan', pkg1d_t.att(a) = 'paid/TXN-r1ca/100.00' and pg_temp.r1events(a) = 1);
end $$;

-- R1-6: capacity full on an open schedule: PKG-1c paid_unallocated, unchanged.
do $$ declare s uuid; o text; o2 text; begin
  s := pkg1c_t.schedule('r1f', 1);
  insert into t_reg values ('r1fa', pkg1c_t.reg(s, 'r1fa'), s);
  perform pkg1c_t.bill(pg_temp.r('r1fa'), 'r1fa');
  perform pkg1c_t.expire_hold(pg_temp.r('r1fa'));
  insert into t_reg values ('r1fb', pkg1c_t.reg(s, 'r1fb'), s);
  perform pkg1c_t.bill(pg_temp.r('r1fb'), 'r1fb');
  o2 := pg_temp.cbj('r1fb');
  o := pg_temp.cbj('r1fa');
  perform pg_temp.chk('R1-6 kapasiti penuh: kedua confirmed, lewat paid_unallocated', o2 = 'confirmed|-' and o = 'paid_unallocated|-', o2 || ' ' || o);
  perform pg_temp.chk('R1-6 kerusi diambil <= kapasiti, tiada acara R1', pkg1c_t.taken(s) = 1 and pkg1c_t.enrolled(s) = 1
    and pg_temp.r1events(pkg1d_t.bill_id('r1fa')) = 0);
end $$;

-- R1-7: unexpected CRM errors still propagate and roll everything back (never converted into reconciliation).
do $$ declare s uuid; o text; a uuid; begin
  s := pkg1c_t.schedule('r1x', 5);
  insert into t_reg values ('r1x', pkg1c_t.reg(s, 'r1x'), s);
  a := pkg1c_t.bill(pg_temp.r('r1x'), 'r1x');
  -- Rolled back with the surrounding check transaction.
  create function public.r1_inject_failure() returns trigger language plpgsql as $f$ begin raise exception 'r1_injected_failure'; end $f$;
  create trigger r1_inject before insert on public.schedule_participants for each row execute function public.r1_inject_failure();
  o := pg_temp.cbj('r1x');
  drop trigger r1_inject on public.schedule_participants;
  perform pg_temp.chk('R1-7 ralat tidak dijangka semasa enrolmen: raise (bukan reconciliation_required)', o like 'ERR:r1_injected_failure%', o);
  perform pg_temp.chk('R1-7 seluruh panggilan di-rollback: percubaan kekal processing tanpa txn, pendaftaran tidak berubah',
    pkg1d_t.att(a) = 'processing/-/-' and pkg1c_t.state(pg_temp.r('r1x')) = 'payment_pending/processing/hold', pkg1d_t.att(a));
  perform pg_temp.chk('R1-7 tiada audit R1 dan tiada bukti R1', pg_temp.r1events(a) = 0
    and not (select raw_response ? 'schedule_not_finalizable' from public.public_registration_payments where id = a));
  o := pkg1c_t.retry(pg_temp.r('r1x'));
  perform pg_temp.chk('R1-7 crm terus tanpa bayaran: registration_payment_not_confirmed masih raise', o like 'ERR:P0001:registration_payment_not_confirmed%', o);
end $$;

-- R1-8: staff-verified bank transfer after the schedule was cancelled (registration payment_status failed, B7).
do $$ declare s uuid; o text; bank uuid; begin
  s := pkg1c_t.schedule('r1m', 5);
  insert into t_reg values ('r1m', pkg1c_t.reg(s, 'r1m'), s);
  perform pkg1c_t.bill(pg_temp.r('r1m'), 'r1m');
  perform pkg1d_t.fail('r1m');
  perform pg_temp.cancel(s, 'cancelled');
  o := pkg1d_t.manual_as(pg_temp.r('r1m'), 'r1m', '00000000-0000-0000-0000-00000000a001', 'authenticated');
  select id into bank from public.public_registration_payments where registration_id = pg_temp.r('r1m') and payment_provider = 'bank_transfer';
  perform pg_temp.chk('R1-8 manual selepas jadual dibatalkan: reconciliation_required', o = 'reconciliation_required', o);
  perform pg_temp.chk('R1-8 rekod bank paid kekal, tiada kerusi, hold dilepaskan',
    (select status || '/' || verified_amount from public.public_registration_payments where id = bank) = 'paid/100.00'
    and pkg1c_t.enrolled(s) = 0 and pkg1c_t.state(pg_temp.r('r1m')) = 'failed/paid/nohold', pkg1c_t.state(pg_temp.r('r1m')));
  perform pg_temp.chk('R1-8 audit: satu manual_payment_recorded dan satu schedule_not_finalizable_recorded oleh pengesah admin',
    pkg1d_t.events(bank, 'manual_payment_recorded') = 1 and pg_temp.r1events(bank) = 1
    and exists (select 1 from public.audit_logs where entity_id = bank::text and metadata->>'event' = 'schedule_not_finalizable_recorded'
      and actor_id = '00000000-0000-0000-0000-00000000a001' and metadata->>'payment_provider' = 'bank_transfer' and metadata->>'payment_reference' = 'BANK-r1m'));
  o := pkg1d_t.manual_as(pg_temp.r('r1m'), 'r1m', '00000000-0000-0000-0000-00000000a001', 'authenticated');
  perform pg_temp.chk('R1-8 pengesahan berulang: already_paid, satu rekod bank, tiada audit tambahan', o = 'already_paid'
    and (select count(*) from public.public_registration_payments where registration_id = pg_temp.r('r1m') and payment_provider = 'bank_transfer') = 1
    and pg_temp.r1events(bank) = 1, o);
  -- Manual on an open schedule is unchanged.
  s := pkg1c_t.schedule('r1mo', 5);
  insert into t_reg values ('r1mo', pkg1c_t.reg(s, 'r1mo'), s);
  o := pkg1d_t.manual_as(pg_temp.r('r1mo'), 'r1mo', '00000000-0000-0000-0000-00000000a001');
  perform pg_temp.chk('R1-8 manual pada jadual open: confirmed (tidak berubah)', o = 'confirmed' and pkg1c_t.enrolled(s) = 1, o);
end $$;

-- Separate paid attempts on one registration (sequential, functional): ToyyibPay then bank transfer, cancelled schedule.
do $$ declare s uuid; o1 text; o2 text; a uuid; bank uuid; begin
  s := pkg1c_t.schedule('r1d', 5);
  insert into t_reg values ('r1d', pkg1c_t.reg(s, 'r1d'), s);
  a := pkg1c_t.bill(pg_temp.r('r1d'), 'r1d');
  perform pg_temp.cancel(s, 'cancelled');
  o1 := pg_temp.cbj('r1d');
  o2 := pkg1d_t.manual_as(pg_temp.r('r1d'), 'r1d', '00000000-0000-0000-0000-00000000a001');
  select id into bank from public.public_registration_payments where registration_id = pg_temp.r('r1d') and payment_provider = 'bank_transfer';
  perform pg_temp.chk('R1 dua rekod wang berasingan pada satu pendaftaran: kedua-dua direkod, dua audit, tiada kerusi',
    o1 = 'reconciliation_required|schedule_not_finalizable' and o2 = 'reconciliation_required'
    and (select count(*) from public.public_registration_payments where registration_id = pg_temp.r('r1d') and status = 'paid') = 2
    and pg_temp.r1events(a) = 1 and pg_temp.r1events(bank) = 1 and pkg1c_t.enrolled(s) = 0, o1 || ' ' || o2);
end $$;

select 'RESULT|' || case when ok then 'PASS' else 'FAIL' end || '|' || name || '|' || replace(detail, '|', '/') from t_results order by ord;
`;

// R1-5 concurrency: genuinely simultaneous committed sessions (fixtures are committed, keys are unique per run).
let raceNo = 0;
// The relation whose row the waiting session is queued on (its tuple lock), as in the PKG-1d-A T17 check.
const lockedRelation = (marker: string) => psql(`select coalesce(string_agg(distinct l.relation::regclass::text, ','), '-') from pg_locks l
  join pg_stat_activity s on s.pid = l.pid where l.locktype = 'tuple' and s.query like '%${marker.replace(/'/g, "''")}%' and s.query not like '%pg_locks%';`).trim();
const fixture = (k: string, cap = 5) => psql(`do $$ declare s uuid; r uuid; begin
  s := pkg1c_t.schedule('${k}', ${cap}); r := pkg1c_t.reg(s, '${k}'); perform pkg1c_t.bill(r, '${k}'); end $$;
  select cs.id from public.course_schedules cs join public.courses c on c.id = cs.course_id where c.slug = 'synthetic-pkg1c-${k}';`).trim().split("\n").pop()!;
const facts = (k: string, s: string) => psql(`select (select count(*) from public.public_registration_payments p join public.public_registrations r on r.id = p.registration_id
    where r.schedule_id = '${s}' and p.status = 'paid') || '|' || pkg1c_t.enrolled('${s}') || '|' ||
    (select status::text from public.course_schedules where id = '${s}') || '|' ||
    (select count(*) from public.audit_logs where metadata->>'event' = 'schedule_not_finalizable_recorded' and entity_id = (select id::text from public.public_registration_payments where provider_bill_code = 'BILL-${k}'));`).trim().split("|");
const cbSql = (k: string) => `select (pkg1c_t.cb('${k}'));`;

// (a) two callbacks for the same attempt on a cancelled schedule.
const raceDuplicate = async () => {
  const k = `r1race${++raceNo}d`;
  const s = fixture(k);
  psql(`update public.course_schedules set status = 'cancelled' where id = '${s}';`);
  const a = session(`begin;\n${cbSql(k)}\nselect pg_sleep(4);\ncommit;\n`);
  await sleep(1200);
  const b = session(`${cbSql(k)}\n`);
  await sleep(1300);
  const rel = lockedRelation(`pkg1c_t.cb('${k}')`);
  const [ra, rb] = await Promise.all([a, b]);
  const [paid, enrolled, status, events] = facts(k, s);
  return { a: ra.out.trim().split("\n")[0], b: rb.out.trim().split("\n")[0], bMs: rb.ms, rel, paid: Number(paid), enrolled: Number(enrolled), status, events: Number(events) };
};
// (b) the schedule is cancelled in a transaction that commits while the callback waits (cancellation wins).
const raceCancelFirst = async () => {
  const k = `r1race${++raceNo}c`;
  const s = fixture(k);
  const x = session(`begin;\nupdate public.course_schedules set status = 'cancelled' where id = '${s}';\nselect pg_sleep(4);\ncommit;\n`);
  await sleep(1200);
  const a = session(`${cbSql(k)}\n`);
  await sleep(1300);
  const rel = lockedRelation(`pkg1c_t.cb('${k}')`);
  const [rx, ra] = await Promise.all([x, a]);
  const [paid, enrolled, status, events] = facts(k, s);
  return { x: rx.out.trim(), a: ra.out.trim().split("\n")[0], aMs: ra.ms, rel, paid: Number(paid), enrolled: Number(enrolled), status, events: Number(events) };
};
// (c) the callback commits first while the cancellation waits (callback wins).
const raceCallbackFirst = async () => {
  const k = `r1race${++raceNo}w`;
  const s = fixture(k);
  const a = session(`begin;\n${cbSql(k)}\nselect pg_sleep(4);\ncommit;\n`);
  await sleep(1200);
  const x = session(`update public.course_schedules set status = 'cancelled' where id = '${s}';\n`);
  await sleep(1300);
  const waiting = Number(psql(`select count(*) from pg_stat_activity where wait_event_type = 'Lock' and query like '%update public.course_schedules set status%' and query not like '%pg_stat_activity%';`).trim());
  const [ra, rx] = await Promise.all([a, x]);
  const [paid, enrolled, status, events] = facts(k, s);
  return { a: ra.out.trim().split("\n")[0], x: rx.out.trim(), xMs: rx.ms, waiting, paid: Number(paid), enrolled: Number(enrolled), status, events: Number(events) };
};
// (d) two separate attempts of one registration paid at the same time (old bill A failed then paid late, new bill B
// paid), on a cancelled schedule: both money records kept, no seat, no deadlock.
const raceTwoAttempts = async () => {
  const k = `r1race${++raceNo}t`;
  psql(`do $$ declare s uuid; r uuid; begin
    s := pkg1c_t.schedule('${k}', 5); r := pkg1c_t.reg(s, '${k}');
    perform pkg1c_t.bill(r, '${k}'); perform pkg1d_t.fail('${k}'); perform pkg1d_t.rebill(r, '${k}', '${k}b');
    update public.course_schedules set status = 'cancelled' where id = s; end $$;`);
  const s = psql(`select cs.id from public.course_schedules cs join public.courses c on c.id = cs.course_id where c.slug = 'synthetic-pkg1c-${k}';`).trim();
  const a = session(`begin;\n${cbSql(`${k}b`)}\nselect pg_sleep(4);\ncommit;\n`);
  await sleep(1200);
  const b = session(`${cbSql(k)}\n`);
  const [ra, rb] = await Promise.all([a, b]);
  const paid = Number(psql(`select count(*) from public.public_registration_payments p join public.public_registrations r on r.id = p.registration_id
    where r.schedule_id = '${s}' and p.status = 'paid';`).trim());
  return { a: ra.out.trim().split("\n")[0], b: rb.out.trim().split("\n")[0], bMs: rb.ms, paid, enrolled: Number(psql(`select pkg1c_t.enrolled('${s}');`).trim()) };
};

// R1-10 mutations: each applied to the A5 file text, then it must be caught.
const RET = "  return public.finalize_public_registration_crm(v_registration.id);";
const GUARD_IF = "  if not found or v_schedule_status in ('cancelled', 'completed') then";
const nth = (text: string, needle: string, n: number) => { let i = -1; for (let k = 0; k <= n; k += 1) { i = text.indexOf(needle, i + 1); if (i < 0) return -1; } return i; };
const replaceNth = (text: string, needle: string, repl: string, n: number) => { const i = nth(text, needle, n); return i < 0 ? text : text.slice(0, i) + repl + text.slice(i + needle.length); };
const MUTATIONS: { id: string; name: string; apply: (t: string) => string; detect: "checks" | "raceCancel" }[] = [
  { id: "M1", name: "sekatan jadual dibuang (callback)", apply: (t) => replaceNth(t, GUARD_IF, "  if false then", 0), detect: "checks" },
  { id: "M2", name: "sekatan jadual dibuang (manual)", apply: (t) => replaceNth(t, GUARD_IF, "  if false then", 1), detect: "checks" },
  { id: "M3", name: "'completed' tidak dikesan", apply: (t) => replaceNth(t, GUARD_IF, "  if not found or v_schedule_status in ('cancelled') then", 0), detect: "checks" },
  { id: "M4", name: "pengendali EXCEPTION luas di sekeliling crm (callback)",
    apply: (t) => replaceNth(t, RET, "  begin\n    return public.finalize_public_registration_crm(v_registration.id);\n  exception when others then\n    return jsonb_build_object('outcome', 'reconciliation_required');\n  end;", 0), detect: "checks" },
  // The first match inside a function body (the header comment also names the event).
  { id: "M5", name: "audit R1 dibuang (callback)",
    apply: (t) => replaceNth(t, "jsonb_build_object('event', 'schedule_not_finalizable_recorded'", "jsonb_build_object('event', 'r1_mutated_event'", 0), detect: "checks" },
  { id: "M6", name: "hold tidak dilepaskan (callback)", apply: (t) => replaceNth(t, "    update public.public_registrations set hold_expires_at = null where id = v_registration.id;\n", "", 0), detect: "checks" },
  { id: "M7", name: "FOR UPDATE pada jadual dibuang (callback, perlumbaan)", apply: (t) => replaceNth(t, "  where cs.id = v_registration.schedule_id\n  for update;", "  where cs.id = v_registration.schedule_id;", 0), detect: "raceCancel" },
];

try {
  try { docker(["image", "inspect", image]); } catch {
    console.log(`TIDAK DAPAT DIUJI: imej ${image} tiada secara setempat (tiada muat turun dibuat).`);
    process.exit(2);
  }
  docker(["run", "-d", "--name", container, "-e", "POSTGRES_PASSWORD=r1_disposable_only", image]);
  for (let attempt = 0; ; attempt += 1) {
    try { docker(["exec", container, "pg_isready", "-U", "postgres", "-h", "127.0.0.1"]); psql("select 1;"); break; }
    catch { if (attempt > 90) throw new Error("Disposable PostgreSQL did not become ready"); await sleep(1000); }
  }
  psql(read("supabase/baseline/v3/bootstrap.sql"));
  for (const file of predecessors) psql(read(file));
  // Mirror the live privileges (Baseline V3 still grants anon EXECUTE on these; Staging/Production do not).
  psql(`revoke execute on function ${FN.crm} from anon; revoke execute on function ${FN.cb} from anon, authenticated;
    revoke execute on function ${FN.verify} from anon;`);
  report(JSON.stringify(md5s()) === JSON.stringify(PINNED), "persediaan: callback, manual dan crm = badan live PKG-1d-A/PKG-1c (md5)", JSON.stringify(md5s()));
  report(JSON.stringify(grants()) === JSON.stringify(LIVE_GRANTEES), "persediaan: hak EXECUTE sama dengan Staging", JSON.stringify(grants()));
  const sigBefore = signatures();
  const ROLLBACK_SQL = (["verify", "cb"] as const).map((k) => `${psql(`select pg_get_functiondef('${FN[k]}'::regprocedure);`).trim()};`).join("\n");
  psql(pkg1cHelpers);
  psql(pkg1dHelpers);
  const othersBefore = otherBodies();

  // Before A5: the R1 defect is real (whole call rolled back, payment recorded nowhere).
  const pre = runChecks(R1_CHECKS);
  const preFailed = failedNames(pre);
  report(preFailed.some((n) => n.startsWith("R1-2 jadual cancelled")) && preFailed.some((n) => n.startsWith("R1-8 manual selepas")),
    "sebelum A5: kecacatan R1 wujud (callback dan manual pada jadual dibatalkan gagal; bayaran tidak direkod)", preFailed.slice(0, 3).join("; "));
  const pkg1cBase = runChecks(pkg1cChecks);
  const pkg1dBase = runChecks(pkg1dChecks);
  // The pre-A5 state already contains PKG-1d-A, which supersedes exactly D6 and D8 (see its own contract).
  const PKG1D_A_SUPERSEDED = ["D6 amaun salah: payment_amount_mismatch", "D8 percubaan kekal cancelled, txn dan bendera rekonsiliasi direkod"];
  report(pkg1cBase.results.length >= 60 && JSON.stringify(failedNames(pkg1cBase).sort()) === JSON.stringify([...PKG1D_A_SUPERSEDED].sort()),
    `garis dasar: semakan PKG-1c sebelum A5 (${pkg1cBase.results.length}) -- hanya D6/D8 berbeza (diganti oleh PKG-1d-A)`, failedNames(pkg1cBase).join("; "));
  report(pkg1dBase.results.length >= 40 && pkg1dBase.results.every((r) => r.ok), `garis dasar: semakan PKG-1d-A lulus sebelum A5 (${pkg1dBase.results.length})`, failedNames(pkg1dBase).join("; "));

  // Apply A5 (twice: idempotent).
  psql(a5Sql);
  const applied = md5s();
  psql(a5Sql);
  report(JSON.stringify(md5s()) === JSON.stringify(applied), "A5 idempoten (dijalankan dua kali, badan sama)");
  report(applied.cb !== PINNED.cb && applied.verify !== PINNED.verify, "A5 menggantikan tepat dua badan (callback, manual)", JSON.stringify(applied));
  report(applied.crm === PINNED.crm, "finalize_public_registration_crm tidak berubah", applied.crm);
  report(otherBodies() === othersBefore, "tiada fungsi pendaftaran/pembayaran/audit/CRM lain berubah");

  // R1-9: privileges, owner, SECURITY DEFINER, search_path and signatures.
  report(JSON.stringify(grants()) === JSON.stringify(LIVE_GRANTEES), "R1-9 hak EXECUTE tidak berubah (anon tiada; callback service_role sahaja)", JSON.stringify(grants()));
  const cfg = Object.fromEntries(Object.entries(FN).map(([k, fn]) => [k, config(fn)]));
  report(JSON.stringify(cfg) === JSON.stringify(CONFIG), "R1-9 SECURITY DEFINER dan search_path tidak berubah", JSON.stringify(cfg));
  report(owner(FN.cb) === "postgres" && owner(FN.verify) === "postgres", "R1-9 pemilik kekal postgres");
  report(signatures() === sigBefore, "R1-9 tandatangan dan jenis pulangan tidak berubah");

  // R1-1..R1-8 on A5.
  const run = runChecks(R1_CHECKS);
  for (const r of run.results) report(r.ok, r.name, r.detail);
  report(run.results.length >= 30, `bilangan semakan R1 (${run.results.length})`);

  // R1-12: the unchanged PKG-1c and PKG-1d-A checks on top of A5.
  const c12 = runChecks(pkg1cChecks);
  report(c12.results.length === pkg1cBase.results.length, `R1-12 semakan PKG-1c dijalankan semula atas A5: bilangan sama (${c12.results.length})`);
  report(JSON.stringify(failedNames(c12).sort()) === JSON.stringify([...PKG1C_SUPERSEDED].sort()),
    `R1-12 PKG-1c: hanya perubahan sengaja yang dinamakan berbeza (D6, D8, blok rollback jadual dibatalkan); ${c12.results.length - failedNames(c12).length} lain lulus`,
    failedNames(c12).join("; "));
  const d12 = runChecks(pkg1dChecks);
  report(d12.results.length === pkg1dBase.results.length && d12.results.every((r) => r.ok), `R1-12 semua semakan PKG-1d-A lulus atas A5 (${d12.results.length})`, failedNames(d12).join("; "));

  // R1-11: forward rollback to the exact previous bodies, then re-apply.
  psql(ROLLBACK_SQL);
  report(JSON.stringify(md5s()) === JSON.stringify(PINNED), "R1-11 rollback: badan sebelumnya dipulihkan tepat (md5)", JSON.stringify(md5s()));
  report(JSON.stringify(grants()) === JSON.stringify(LIVE_GRANTEES), "R1-11 rollback: hak EXECUTE tidak berubah");
  const rolled = runChecks(R1_CHECKS);
  report(failedNames(rolled).some((n) => n.startsWith("R1-2 jadual cancelled")), "R1-11 rollback: tingkah laku lama kembali (kecacatan R1 muncul semula)");
  const rolledC = runChecks(pkg1cChecks);
  report(rolledC.results.every((r) => r.ok || ["D6 amaun salah: payment_amount_mismatch", "D8 percubaan kekal cancelled, txn dan bendera rekonsiliasi direkod"].includes(r.name)),
    "R1-11 rollback: semakan PKG-1c kembali seperti atas PKG-1d-A", failedNames(rolledC).join("; "));
  psql(a5Sql);
  report(JSON.stringify(md5s()) === JSON.stringify(applied), "R1-11 guna semula selepas rollback: badan sama");
  const again = runChecks(R1_CHECKS);
  report(again.results.length === run.results.length && again.results.every((r) => r.ok), "R1-11 guna semula: semua semakan R1 lulus semula", failedNames(again).join("; "));

  // R1-5 concurrency (committed fixtures; after every check that inspects all rows).
  const d = await raceDuplicate();
  console.log(`      bukti: ${JSON.stringify(d)}`);
  report(d.a === "reconciliation_required" && d.b === "duplicate_ignored" && d.rel.includes("public_registrations") && d.bMs >= 2500
    && d.paid === 1 && d.enrolled === 0 && d.events === 1,
    "R1-5a dua callback serentak, jadual dibatalkan: B menunggu kunci pendaftaran, satu rekod wang, satu audit", JSON.stringify(d));
  const c = await raceCancelFirst();
  console.log(`      bukti: ${JSON.stringify(c)}`);
  report(!/ERR|deadlock/i.test(c.x + c.a) && c.a === "reconciliation_required" && c.rel.includes("course_schedules") && c.aMs >= 2500
    && c.paid === 1 && c.enrolled === 0 && c.status === "cancelled" && c.events === 1,
    "R1-5b pembatalan menang: callback menunggu kunci JADUAL, kemudian reconciliation_required, bayaran kekal", JSON.stringify(c));
  const w = await raceCallbackFirst();
  console.log(`      bukti: ${JSON.stringify(w)}`);
  report(!/ERR|deadlock/i.test(w.a + w.x) && w.a === "confirmed" && w.waiting >= 1 && w.xMs >= 2500
    && w.paid === 1 && w.enrolled === 1 && w.status === "cancelled" && w.events === 0,
    "R1-5c callback menang: pembatalan menunggu, confirmed dahulu, tiada kebuntuan", JSON.stringify(w));
  const t = await raceTwoAttempts();
  console.log(`      bukti: ${JSON.stringify(t)}`);
  report(!/ERR|deadlock/i.test(t.a + t.b) && t.a === "reconciliation_required" && t.b === "reconciliation_required" && t.bMs >= 2500 && t.paid === 2 && t.enrolled === 0,
    "R1-5d dua percubaan berasingan dibayar serentak (jadual dibatalkan): dua rekod wang, tiada kerusi, tiada kebuntuan", JSON.stringify(t));

  // R1-10 mutations.
  let caught = 0;
  for (const m of MUTATIONS) {
    const mutated = m.apply(a5Sql);
    if (mutated === a5Sql) { report(false, `${m.id} ${m.name}: teks sasaran mutasi tidak ditemui (tidak dikira)`); continue; }
    // The precondition accepts the r1 marker, so a mutated A5 re-applies over A5.
    try { psql(mutated); } catch (error) { report(false, `${m.id} ${m.name}: mutasi tidak dapat digunakan`, (error as Error).message.split("\n")[0]); continue; }
    if (JSON.stringify(md5s()) === JSON.stringify(applied)) { report(false, `${m.id} ${m.name}: badan tidak berubah (tidak dikira)`); psql(a5Sql); continue; }
    let detected = false;
    let detail = "";
    if (m.detect === "raceCancel") {
      const r = await raceCancelFirst();
      detected = r.a !== "reconciliation_required" || r.paid !== 1;
      detail = JSON.stringify(r);
    } else {
      const res = runChecks(R1_CHECKS);
      detected = failedNames(res).length > 0;
      detail = failedNames(res).slice(0, 2).join("; ");
    }
    if (detected) caught += 1;
    report(detected, `${m.id} ${m.name}: ditolak oleh ujian`, detail);
    if (detected) console.log(`      dikesan oleh: ${detail.slice(0, 180)}`);
    psql(a5Sql);
  }
  report(caught === MUTATIONS.length, `${caught}/${MUTATIONS.length} mutasi ditolak`);
  report(JSON.stringify(md5s()) === JSON.stringify(applied), "akhir: badan A5 dipulihkan selepas mutasi");
} finally {
  try { docker(["rm", "-f", container]); } catch { /* container may not exist */ }
}

console.log(failures ? `\n${failures} semakan GAGAL` : "\nSemua semakan kontrak DB R1 lulus");
process.exit(failures ? 1 : 0);
