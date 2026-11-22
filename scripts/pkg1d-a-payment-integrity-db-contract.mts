import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { classifyRegistration, type PaymentInput, type RegistrationInput } from "../lib/registrations/reviewQueue.ts";

// Verifies the four PKG-1d-A migrations against an isolated, disposable local PostgreSQL (the Supabase Postgres image)
// bootstrapped from Baseline V3 + 20261106090000 + PKG-1 + PKG-1c. It never connects to Supabase, Staging, Production
// or ToyyibPay, uses synthetic fixtures only, and removes its container on exit. The T/U checks run in
// scripts/pkg1d-a-payment-integrity-db-contract.sql; this runner adds the pre-fix defect proof, U1 (privileges and
// security settings), T16 (the unchanged PKG-1c checks re-run on top of PKG-1d-A, with exactly two named intentional
// changes), the PKG-1c D4 capacity race on PKG-1d-A, T17-T19 (concurrency), T25 (rollback and re-apply) and the
// negative mutations M1-M12, each of which must actually be applied and then be caught.
const root = new URL("..", import.meta.url);
const image = "public.ecr.aws/supabase/postgres:17.6.1.166";
const container = `teras-pkg1d-a-db-${process.pid}`;
const predecessors = [
  "supabase/migrations/20261106090000_public_registration_positive_fee_only.sql",
  "supabase/migrations/20261122100000_revoke_public_execute_registration_rpcs.sql",
  "supabase/migrations/20261122110000_public_registration_capacity_safe_finalization.sql",
];
const MIG = {
  a1: "supabase/migrations/20261122120000_public_registration_payment_guard_late_success.sql",
  a2: "supabase/migrations/20261122121000_public_registration_late_success_recording.sql",
  a3: "supabase/migrations/20261122122000_public_registration_manual_payment_states.sql",
  a4: "supabase/migrations/20261122123000_public_registration_begin_payment_paid_guard.sql",
} as const;
const FN = {
  guard: "app.public_registration_payment_state_guard()",
  cb: "public.finalize_public_registration_payment_from_callback(uuid,text,numeric,text,timestamptz,jsonb)",
  verify: "public.verify_public_registration_manual_payment(text,text,numeric,text,text,uuid)",
  begin: "public.begin_public_registration_payment(text,text,text)",
  crm: "public.finalize_public_registration_crm(uuid)",
} as const;
// Pinned bodies (md5 of pg_get_functiondef without whitespace): live on Staging and Production on 22 Nov 2026 for the
// guard, begin and manual verification; the PKG-1c bodies (20261122110000) for the two finalization functions.
const PINNED = { guard: "72758ed85418fdfdaadd414fb4dad917", cb: "6193a289cf03f8fc9cb3fa5b4e4c52b8", verify: "b8ad44d4ad70f1412fbfe184e03fdc96",
  begin: "f39fbc4261fbc8043a4d6e45ef86059d", crm: "fe568112a7c9a2ae8ad765557dc5f8c6" };
// Live privileges on 22 Nov 2026 (identical on Staging and Production).
const LIVE_GRANTEES = { guard: "postgres", cb: "postgres,service_role", verify: "authenticated,postgres,service_role", begin: "postgres,service_role",
  crm: "authenticated,postgres,service_role" };
const CONFIG = { guard: "false:", cb: "true:search_path=pg_catalog, public, app", verify: "true:search_path=pg_catalog, public, app, extensions",
  begin: "true:search_path=pg_catalog, public, extensions", crm: "true:search_path=pg_catalog, public, app, extensions" };
// The two PKG-1c checks whose behaviour PKG-1d-A changes on purpose (documented in PKG1D-A-KDEV-STOP-REPORT.md):
const SUPERSEDED = [
  "D6 amaun salah: payment_amount_mismatch", // now outcome 'amount_mismatch' with the evidence kept, no raise
  "D8 percubaan kekal cancelled, txn dan bendera rekonsiliasi direkod", // now recorded 'paid' after trusted verification
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
const pkg1cHelpers = section(pkg1cSql, "-- @@helpers", "-- @@checks");
const pkg1cChecks = section(pkg1cSql, "-- @@checks");
const ownSql = read("scripts/pkg1d-a-payment-integrity-db-contract.sql");
const ownHelpers = section(ownSql, "-- @@helpers", "-- @@checks");
const ownChecks = section(ownSql, "-- @@checks");
const migrationSql = Object.fromEntries(Object.entries(MIG).map(([k, p]) => [k, read(p)])) as Record<keyof typeof MIG, string>;
const applyAll = () => { for (const k of ["a1", "a2", "a3", "a4"] as const) psql(migrationSql[k]); };

let failures = 0;
const report = (ok: boolean, name: string, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "LULUS" : "GAGAL"} ${name}${detail && !ok ? ` -> ${detail}` : ""}`);
};
const errorOf = (fn: () => void) => { try { fn(); return ""; } catch (e) { return (e as Error).message; } };

const md5 = (fn: string) => psql(`select md5(regexp_replace(pg_get_functiondef('${fn}'::regprocedure), '\\s+', '', 'g'));`).trim();
const md5s = () => Object.fromEntries(Object.entries(FN).map(([k, fn]) => [k, md5(fn)])) as Record<keyof typeof FN, string>;
const grantees = (fn: string) => psql(`select string_agg(distinct a.grantee::regrole::text, ',' order by a.grantee::regrole::text)
  from pg_proc p, lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  where p.oid = '${fn}'::regprocedure and a.privilege_type = 'EXECUTE';`).trim();
const config = (fn: string) => psql(`select prosecdef::text || ':' || coalesce(array_to_string(proconfig, ','), '') from pg_proc where oid = '${fn}'::regprocedure;`).trim();
const otherBodies = () => psql(`select string_agg(p.oid::regprocedure::text || '=' || md5(regexp_replace(pg_get_functiondef(p.oid), '\\s+', '', 'g')), ';' order by p.oid::regprocedure::text)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where ((n.nspname = 'public' and (p.proname like '%public_registration%' or p.proname in ('log_event_as_service')))
     or (n.nspname = 'app' and p.proname in ('sync_schedule_seats', 'public_registration_state_guard', 'toyyibpay_system_actor', 'is_admin', 'audit_trigger')))
    and p.oid not in ('${FN.cb}'::regprocedure, '${FN.verify}'::regprocedure, '${FN.begin}'::regprocedure);`).trim();
const triggerAttached = () => psql(`select count(*) from pg_trigger where tgname = 'trg_public_registration_payment_state_guard'
  and tgrelid = 'public.public_registration_payments'::regclass and tgfoid = '${FN.guard}'::regprocedure and not tgisinternal;`).trim() === "1";

interface CheckRun { results: { ok: boolean; name: string; detail: string }[]; queue: Map<string, { reg: RegistrationInput; payments: PaymentInput[] }> }
const runChecks = (checks: string): CheckRun => {
  const out = psql(`begin;\n${checks}\nrollback;\n`);
  const results: CheckRun["results"] = [];
  const queue: CheckRun["queue"] = new Map();
  for (const line of out.split("\n")) {
    const m = /^RESULT\|(PASS|FAIL)\|([^|]*)\|(.*)$/.exec(line.trim());
    if (m) results.push({ ok: m[1] === "PASS", name: m[2], detail: m[3] });
    const q = /^QUEUE\|([^|]+)\|(.*)$/.exec(line.trim());
    if (q) queue.set(q[1], JSON.parse(q[2]));
  }
  return { results, queue };
};
const runChecksSafe = (checks: string): CheckRun => {
  try { return runChecks(checks); } catch (error) { return { results: [{ ok: false, name: "pelaksanaan semakan SQL", detail: (error as Error).message.split("\n")[0] }], queue: new Map() }; }
};
const failedNames = (run: CheckRun) => run.results.filter((r) => !r.ok).map((r) => r.name);

// PKG-1c D4 on top of PKG-1d-A: two sessions finalize the last seat at the same time.
let raceNo = 0;
const capacityRace = async (mode: "callback" | "manual") => {
  raceNo += 1;
  const k = `race${raceNo}${mode[0]}`;
  psql(`do $$ declare s uuid; r1 uuid; r2 uuid; begin
    s := pkg1c_t.schedule('${k}', 1);
    r1 := pkg1c_t.reg(s, '${k}a'); perform pkg1c_t.bill(r1, '${k}a'); perform pkg1c_t.expire_hold(r1);
    r2 := pkg1c_t.reg(s, '${k}b'); ${mode === "callback" ? `perform pkg1c_t.bill(r2, '${k}b');` : ""} perform pkg1c_t.expire_hold(r2);
  end $$;`);
  const second = mode === "callback" ? `select pkg1c_t.cb('${k}b');`
    : `select pkg1c_t.manual((select r.id from public.public_registrations r join public.public_registration_attendees a on a.registration_id = r.id where a.email = '${k}b-1@example.invalid'), '${k}b');`;
  const a = session(`begin;\nselect pkg1c_t.cb('${k}a');\nselect pg_sleep(4);\ncommit;\n`);
  await sleep(1200);
  const b = session(`${second}\n`);
  await sleep(1500);
  const waiting = Number(psql(`select count(*) from pg_stat_activity where wait_event_type = 'Lock' and query like '%pkg1c_t.%' and query not like '%pg_stat_activity%';`).trim());
  const [ra, rb] = await Promise.all([a, b]);
  const facts = psql(`select pkg1c_t.enrolled(cs.id) || '|' || cs.capacity || '|' ||
      (select count(*) from public.public_registration_payments p join public.public_registrations r on r.id = p.registration_id where r.schedule_id = cs.id and p.status = 'paid')
    from public.course_schedules cs join public.courses c on c.id = cs.course_id where c.slug = 'synthetic-pkg1c-${k}';`).trim().split("|").map(Number);
  return { a: ra.out.trim().split("\n")[0], b: rb.out.trim().split("\n")[0], waited: waiting >= 1 && rb.ms >= 1500, enrolled: facts[0], capacity: facts[1], paid: facts[2] };
};

// T17: late success on the old (failed) bill A and the normal callback on the new bill B of ONE registration at the same
// time. Session A holds the registration lock; B must wait for that lock first (its first tuple-lock wait is on
// public_registrations), then see A's committed state.
const lateRace = async () => {
  raceNo += 1;
  const k = `race${raceNo}l`;
  psql(`do $$ declare s uuid; r uuid; begin
    s := pkg1c_t.schedule('${k}', 5);
    r := pkg1c_t.reg(s, '${k}');
    perform pkg1c_t.bill(r, '${k}'); perform pkg1d_t.fail('${k}'); perform pkg1d_t.rebill(r, '${k}', '${k}b');
  end $$;`);
  const a = session(`begin;\nselect pkg1c_t.cb('${k}');\nselect pg_sleep(4);\ncommit;\n`);
  await sleep(1200);
  const b = session(`select pkg1c_t.cb('${k}b');\n`);
  await sleep(1500);
  const lockRel = psql(`select coalesce(string_agg(distinct l.relation::regclass::text, ','), '-') from pg_locks l join pg_stat_activity s on s.pid = l.pid
    where l.locktype = 'tuple' and s.query like '%pkg1c_t.cb(''${k}b'')%';`).trim();
  const [ra, rb] = await Promise.all([a, b]);
  const facts = psql(`select (select count(*) from public.public_registration_payments where registration_id = r.id and status = 'paid') || '|' ||
      pkg1c_t.reg_enrolled(r.id) || '|' || r.payment_status
    from public.public_registrations r join public.public_registration_attendees t on t.registration_id = r.id where t.email = '${k}-1@example.invalid';`).trim().split("|");
  return { a: ra.out.trim().split("\n")[0], b: rb.out.trim().split("\n")[0], bMs: rb.ms, lockRel, paid: Number(facts[0]), enrolled: Number(facts[1]), payment: facts[2] };
};

// T18: callback while expire_public_registrations holds the registration (expire cancels the attempt first).
const expireRace = async () => {
  raceNo += 1;
  const k = `race${raceNo}x`;
  psql(`do $$ declare s uuid; r uuid; begin
    s := pkg1c_t.schedule('${k}', 5); r := pkg1c_t.reg(s, '${k}'); perform pkg1c_t.bill(r, '${k}'); perform pkg1c_t.expire_hold(r);
  end $$;`);
  const a = session(`begin;\nselect pkg1c_t.ctx('service_role');\nselect public.expire_public_registrations();\nselect pg_sleep(4);\ncommit;\n`);
  await sleep(1200);
  const b = session(`select pkg1c_t.cb('${k}');\n`);
  const [ra, rb] = await Promise.all([a, b]);
  const att = psql(`select pkg1c_t.attempt('${k}') || '|' || pkg1c_t.state((select registration_id from public.public_registration_payments where provider_bill_code = 'BILL-${k}'));`).trim();
  return { a: ra.out, b: rb.out.trim().split("\n")[0], bMs: rb.ms, att };
};

// T19: staff allocation (finalize as admin) of a late payment and a normal callback for the last seat, concurrently.
const allocationRace = async () => {
  raceNo += 1;
  const k = `race${raceNo}u`;
  psql(`do $$ declare s uuid; r1 uuid; r2 uuid; begin
    s := pkg1c_t.schedule('${k}', 1);
    r1 := pkg1c_t.reg(s, '${k}a'); perform pkg1c_t.bill(r1, '${k}a'); perform pkg1d_t.fail('${k}a'); perform pkg1c_t.expire_hold(r1);
    r2 := pkg1c_t.reg(s, '${k}b'); perform pkg1c_t.bill(r2, '${k}b'); perform pkg1c_t.expire_hold(r2);
    perform pkg1c_t.cb('${k}a');
  end $$;`);
  const r1 = psql(`select registration_id from public.public_registration_payments where provider_bill_code = 'BILL-${k}a';`).trim();
  const a = session(`begin;\nselect pkg1c_t.retry('${r1}', '00000000-0000-0000-0000-00000000a001');\nselect pg_sleep(4);\ncommit;\n`);
  await sleep(1200);
  const b = session(`select pkg1c_t.cb('${k}b');\n`);
  const [ra, rb] = await Promise.all([a, b]);
  const facts = psql(`select pkg1c_t.enrolled(cs.id) || '|' || cs.capacity from public.course_schedules cs join public.courses c on c.id = cs.course_id where c.slug = 'synthetic-pkg1c-${k}';`).trim().split("|").map(Number);
  return { a: ra.out.trim().split("\n")[0], b: rb.out.trim().split("\n")[0], bMs: rb.ms, enrolled: facts[0], capacity: facts[1] };
};

const MUTATIONS: { id: string; name: string; file: keyof typeof MIG; from: string; to: string; race?: boolean }[] = [
  { id: "M1", name: "syarat txn dibuang daripada peralihan lewat (A1)", file: "a1", from: "       or nullif(btrim(coalesce(new.provider_transaction_id, '')), '') is null\n", to: "" },
  { id: "M2", name: "syarat amaun sama dibuang (A1)", file: "a1", from: "       or round(new.verified_amount, 2) <> round(new.amount, 2)\n", to: "" },
  { id: "M3", name: "failed|cancelled -> paid dibenarkan tanpa syarat (A1)", file: "a1", from: "      raise exception 'invalid_late_success_transition' using errcode = 'P0001';", to: "      null;" },
  { id: "M4", name: "peruntukan kerusi automatik dalam cabang lewat (A2)", file: "a2",
    from: "    return jsonb_build_object('outcome', 'reconciliation_required', 'registration_reference', v_registration.registration_reference,\n      'late_success', true);",
    to: "    return public.finalize_public_registration_crm(v_registration.id);" },
  { id: "M5", name: "raw_response ditulis ganti, bukan digabung (A2)", file: "a2",
    from: "        raw_response = coalesce(raw_response, '{}'::jsonb) || jsonb_build_object(\n          'late_success_reconciliation_required', true,",
    to: "        raw_response = jsonb_build_object(\n          'late_success_reconciliation_required', true," },
  { id: "M6", name: "semakan replay txn sama dibuang (A2)", file: "a2", from: "      return jsonb_build_object('outcome', 'duplicate_ignored');", to: "      null;" },
  { id: "M7", name: "txn disimpan semasa amaun berbeza (A2)", file: "a2",
    from: "      update public.public_registration_payments\n      set raw_response = coalesce(raw_response, '{}'::jsonb) || jsonb_build_object('amount_mismatch',",
    to: "      update public.public_registration_payments\n      set provider_transaction_id = v_txn, raw_response = coalesce(raw_response, '{}'::jsonb) || jsonb_build_object('amount_mismatch'," },
  { id: "M8", name: "amaun berbeza ditanda paid (A2)", file: "a2",
    from: "      update public.public_registration_payments\n      set raw_response = coalesce(raw_response, '{}'::jsonb) || jsonb_build_object('amount_mismatch',",
    to: "      update public.public_registration_payments\n      set status = 'paid', verified_amount = v_amount, verified_at = now(), raw_response = coalesce(raw_response, '{}'::jsonb) || jsonb_build_object('amount_mismatch'," },
  { id: "M9", name: "percubaan terbuka lain tidak dibatalkan (A2)", file: "a2",
    from: "        and payment_provider = 'toyyibpay' and status in ('pending', 'processing')\n      returning 1", to: "        and false\n      returning 1" },
  { id: "M10", name: "langkah failed -> processing dibuang (A3, B7)", file: "a3",
    from: "  if v_registration.payment_status in ('pending', 'failed') then", to: "  if v_registration.payment_status in ('pending') then" },
  { id: "M11", name: "begin tanpa semakan paid (A4)", file: "a4",
    from: "  if v_registration.payment_status = 'paid' then\n    raise exception 'registration_already_paid'", to: "  if false then\n    raise exception 'registration_already_paid'" },
  // Last: the race mutation commits race fixtures (race schedules are excluded from the capacity invariant).
  { id: "M12", name: "kunci pendaftaran dibuang (perlumbaan T17)", file: "a2",
    from: "  where pr.id = (select registration_id from public.public_registration_payments where id = p_attempt_id)\n  for update;",
    to: "  where pr.id = (select registration_id from public.public_registration_payments where id = p_attempt_id);", race: true },
];

try {
  try { docker(["image", "inspect", image]); } catch {
    console.log(`TIDAK DAPAT DIUJI: imej ${image} tiada secara setempat (tiada muat turun dibuat).`);
    process.exit(2);
  }
  docker(["run", "-d", "--name", container, "-e", "POSTGRES_PASSWORD=pkg1d_disposable_only", image]);
  for (let attempt = 0; ; attempt += 1) {
    try { docker(["exec", container, "pg_isready", "-U", "postgres", "-h", "127.0.0.1"]); psql("select 1;"); break; }
    catch { if (attempt > 90) throw new Error("Disposable PostgreSQL did not become ready"); await sleep(1000); }
  }

  psql(read("supabase/baseline/v3/bootstrap.sql"));
  for (const file of predecessors) psql(read(file));
  // Mirror the live privileges (Baseline V3 still grants anon EXECUTE on these; Staging/Production do not).
  psql(`revoke execute on function ${FN.crm} from anon; revoke execute on function ${FN.cb} from anon, authenticated;
    revoke execute on function ${FN.verify} from anon;`);
  const grants = () => Object.fromEntries(Object.entries(FN).map(([k, fn]) => [k, grantees(fn)])) as Record<keyof typeof FN, string>;
  report(JSON.stringify(grants()) === JSON.stringify(LIVE_GRANTEES), "persediaan: hak EXECUTE sama dengan Staging/Production", JSON.stringify(grants()));
  report(JSON.stringify(md5s()) === JSON.stringify(PINNED), "persediaan: badan fungsi = live (pengawal, begin, manual) dan PKG-1c (callback, crm)", JSON.stringify(md5s()));
  // Prepared rollback (forward repair): the exact previous definitions; the callback before the guard.
  const ROLLBACK_SQL = ["begin", "verify", "cb", "guard"].map((k) => `${psql(`select pg_get_functiondef('${FN[k as keyof typeof FN]}'::regprocedure);`).trim()};`).join("\n");
  psql(pkg1cHelpers);
  psql(ownHelpers);
  const othersBefore = otherBodies();

  // Before PKG-1d-A: the defects are real.
  const before = psql(`begin;
    do $$ declare s uuid; a uuid; o text; m text; b text; g text; r uuid; begin
      s := pkg1c_t.schedule('pre', 5);
      r := pkg1c_t.reg(s, 'pre1'); a := pkg1c_t.bill(r, 'pre1'); perform pkg1d_t.fail('pre1');
      o := pkg1c_t.cb('pre1');
      perform set_config('pkg1d.b1', o || '|' || pkg1d_t.att(a) || '|' || (select count(*) from public.audit_logs where entity_id = a::text and metadata ? 'event'), false);
      r := pkg1c_t.reg(s, 'pre2'); perform pkg1c_t.bill(r, 'pre2'); perform pkg1d_t.fail('pre2');
      perform set_config('pkg1d.b7', pkg1d_t.manual_as(r, 'pre2', '00000000-0000-0000-0000-00000000a001'), false);
      r := pkg1c_t.reg(s, 'pre3'); a := pkg1c_t.bill(r, 'pre3');
      perform set_config('pkg1d.b4', pkg1c_t.cb('pre3', 99.99) || '|' || (select (raw_response ? 'amount_mismatch')::text from public.public_registration_payments where id = a), false);
      r := pkg1c_t.reg(s, 'pre4'); perform pkg1c_t.bill(r, 'pre4');
      update public.public_registrations set payment_status = 'paid' where id = r;
      perform set_config('pkg1d.g1', pkg1d_t.begin(r, 'pre4'), false);
    end $$;
    select current_setting('pkg1d.b1') || '#' || current_setting('pkg1d.b7') || '#' || current_setting('pkg1d.b4') || '#' || current_setting('pkg1d.g1');
    rollback;`).trim().split("\n").pop()!.split("#");
  report(before[0] === "terminal_ignored|failed/-/-|0", "sebelum PKG-1d-A (B1): bayaran disahkan pada percubaan failed diabaikan senyap -- tiada txn, amaun atau acara", before[0]);
  report(/invalid_public_payment_transition/.test(before[1]), "sebelum PKG-1d-A (B7): pindahan bank pada payment_status failed gagal dan rollback", before[1]);
  report(/^ERR:payment_amount_mismatch.*\|false$/.test(before[2]), "sebelum PKG-1d-A (B4): amaun berbeza raise, tiada bukti disimpan", before[2]);
  report(before[3] === "OK", "sebelum PKG-1d-A (G1): begin masih menawarkan bil untuk pendaftaran yang sudah paid", before[3]);

  // The unchanged PKG-1c checks on the PKG-1c state: the baseline for T16.
  const pkg1cBase = runChecks(pkg1cChecks);
  report(pkg1cBase.results.length >= 60 && pkg1cBase.results.every((r) => r.ok), `garis dasar: semakan PKG-1c lulus pada keadaan PKG-1c (${pkg1cBase.results.length})`, failedNames(pkg1cBase).join("; "));

  applyAll();
  const applied = md5s();
  applyAll(); // idempotent
  report(JSON.stringify(md5s()) === JSON.stringify(applied), "keempat-empat migrasi idempoten (dijalankan dua kali, badan sama)");
  report(applied.guard !== PINNED.guard && applied.cb !== PINNED.cb && applied.verify !== PINNED.verify && applied.begin !== PINNED.begin,
    "migrasi menggantikan tepat empat badan (pengawal, callback, manual, begin)");
  report(applied.crm === PINNED.crm, "finalize_public_registration_crm (pengawal kapasiti PKG-1c) tidak berubah", applied.crm);
  report(otherBodies() === othersBefore, "tiada fungsi pendaftaran/pembayaran/audit/CRM lain berubah");

  // U1: privileges, SECURITY DEFINER and search_path of every modified function; guard trigger still attached.
  report(JSON.stringify(grants()) === JSON.stringify(LIVE_GRANTEES), "U1 hak EXECUTE kelima-lima fungsi tidak berubah (anon tiada)", JSON.stringify(grants()));
  const configs = Object.fromEntries(Object.entries(FN).map(([k, fn]) => [k, config(fn)]));
  report(JSON.stringify(configs) === JSON.stringify(CONFIG), "U1 SECURITY DEFINER dan search_path tepat (pengawal kekal SECURITY INVOKER)", JSON.stringify(configs));
  report(triggerAttached(), "U1 trigger pengawal masih dipasang pada public_registration_payments");
  for (const [role, fn, call] of [
    ["anon", "finalize_public_registration_payment_from_callback", `select public.finalize_public_registration_payment_from_callback(gen_random_uuid(), 'B', 1, 'T', now(), '{}');`],
    ["authenticated", "finalize_public_registration_payment_from_callback", `select public.finalize_public_registration_payment_from_callback(gen_random_uuid(), 'B', 1, 'T', now(), '{}');`],
    ["anon", "verify_public_registration_manual_payment", `select public.verify_public_registration_manual_payment('R', 'S', 1, 'X');`],
    ["anon", "begin_public_registration_payment", `select public.begin_public_registration_payment('R', 'S');`],
    ["authenticated", "begin_public_registration_payment", `select public.begin_public_registration_payment('R', 'S');`],
  ] as const) {
    report(new RegExp(`permission denied for function ${fn}`).test(errorOf(() => psql(`set role ${role}; ${call}`))), `U1 ${role} -> ${fn}: 42501 permission denied`);
  }

  // PKG-1 security contract on the A4 re-creation (revoke-public-registration-rpcs-contract.mts names A4 as the only
  // approved one): effective privileges and identity from the catalogue, service_role really executes, and A4 variants
  // that would weaken them are refused by A4's own postcondition when applied as one transaction (as db push does).
  // Each variant is first proven effective: without A4's final block it really changes the catalogue (rolled back).
  const BEGIN_META_SQL = `select has_function_privilege('anon', '${FN.begin}', 'execute')::text || '|' ||
    has_function_privilege('authenticated', '${FN.begin}', 'execute')::text || '|' ||
    exists (select 1 from pg_proc p, lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where p.oid = '${FN.begin}'::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE')::text || '|' ||
    has_function_privilege('service_role', '${FN.begin}', 'execute')::text || '|' ||
    (select pg_get_userbyid(proowner) || '|' || pg_get_function_identity_arguments(oid) || '|' || prosecdef::text || '|' ||
      array_to_string(proconfig, ',') from pg_proc where oid = '${FN.begin}'::regprocedure);`;
  const BEGIN_META = "false|false|false|true|postgres|p_registration_reference text, p_registration_secret text, p_provider text|true|search_path=pg_catalog, public, extensions";
  const beginMeta = () => psql(BEGIN_META_SQL).trim();
  report(beginMeta() === BEGIN_META, "PKG-1 begin selepas A4: anon/authenticated/PUBLIC tiada EXECUTE, service_role ada; pemilik, tandatangan, SECURITY DEFINER, search_path kekal", beginMeta());
  const asService = errorOf(() => psql(`set role service_role; select public.begin_public_registration_payment('PKG1D-TIADA', 'x');`));
  report(/registration_not_found/.test(asService) && !/permission denied/.test(asService), "PKG-1 service_role benar-benar melaksanakan begin selepas A4 (sampai ke registration_not_found)", asService.split("\n")[0]);
  const A4_POST_AT = "\ndo $$\ndeclare\n  v_fn constant regprocedure := 'public.begin_public_registration_payment(text,text,text)'::regprocedure;";
  const A4_HEAD = " security definer\n set search_path to 'pg_catalog', 'public', 'extensions'\nas $function$";
  const ACL_NEGATIVES = [
    { id: "N1", name: "GRANT EXECUTE kepada anon", from: A4_POST_AT, to: `\ngrant execute on function ${FN.begin} to anon;\n${A4_POST_AT}` },
    { id: "N2", name: "GRANT EXECUTE kepada authenticated", from: A4_POST_AT, to: `\ngrant execute on function ${FN.begin} to authenticated;\n${A4_POST_AT}` },
    { id: "N3", name: "GRANT EXECUTE kepada PUBLIC", from: A4_POST_AT, to: `\ngrant execute on function ${FN.begin} to public;\n${A4_POST_AT}` },
    { id: "N4", name: "REVOKE EXECUTE daripada service_role", from: A4_POST_AT, to: `\nrevoke execute on function ${FN.begin} from service_role;\n${A4_POST_AT}` },
    { id: "N5", name: "SECURITY DEFINER dibuang", from: A4_HEAD, to: A4_HEAD.replace(" security definer", " security invoker") },
    { id: "N6", name: "search_path diubah", from: A4_HEAD, to: A4_HEAD.replace("'pg_catalog', 'public', 'extensions'", "'public', 'pg_catalog', 'extensions'") },
  ];
  let aclCaught = 0;
  for (const n of ACL_NEGATIVES) {
    const a4 = migrationSql.a4;
    if (a4.split(n.from).length !== 2) { report(false, `${n.id} ${n.name}: teks sasaran tidak ditemui tepat sekali (tidak dikira)`); continue; }
    const mutated = a4.replace(n.from, () => n.to);
    const withoutPost = mutated.slice(0, mutated.lastIndexOf("\ndo $$"));
    const effect = psql(`begin;\n${withoutPost}\n${BEGIN_META_SQL}\nrollback;`).trim().split("\n").pop() ?? "";
    if (effect === BEGIN_META) { report(false, `${n.id} ${n.name}: mutasi tidak mengubah katalog (tidak dikira)`, effect); continue; }
    const refused = errorOf(() => psql(`begin;\n${mutated}\ncommit;`));
    const ok = /pkg1d_a4_postcondition_failed/.test(refused) && beginMeta() === BEGIN_META && md5(FN.begin) === applied.begin;
    if (ok) aclCaught += 1;
    report(ok, `${n.id} ${n.name}: berkesan (${effect.split("|").slice(0, 4).join("/")}) tetapi A4 ditolak oleh pasca-syarat; katalog tidak berubah`, refused.split("\n")[0]);
  }
  report(aclCaught === ACL_NEGATIVES.length, `${aclCaught}/${ACL_NEGATIVES.length} mutasi hak begin ditolak`);

  // T1-T15, T20-T22, U2, U3, U4 (SQL) and the invariants.
  const run = runChecks(ownChecks);
  for (const r of run.results) report(r.ok, r.name, r.detail);
  if (run.results.length < 90) report(false, "bilangan semakan SQL kurang daripada jangkaan", String(run.results.length));

  // U4: the existing staff review-queue classifier (unchanged code) on the PKG-1d-A rows.
  const now = new Date();
  const classify = (k: string) => { const row = run.queue.get(k); return row ? classifyRegistration(row.reg, [], row.payments, { known: false, participantIds: new Set() }, now) : null; };
  const codes = (k: string) => classify(k)?.exceptions.map((e) => e.code) ?? ["<tiada baris>"];
  for (const k of ["t2", "t4", "t12", "t20b"]) {
    const c = classify(k);
    report(!!c && c.stage === "payment_received" && codes(k).includes("paid_not_confirmed") && c.needsAttention
      && !codes(k).includes("amount_mismatch") && !codes(k).includes("duplicate_paid_payments") && c.paidCents === 10000,
      `U4 gilir staf: ${k} (bayaran lewat) "Payment received, not confirmed" + "Paid, not confirmed", diterima RM100`, `${c?.stage} ${codes(k).join(",")} ${c?.paidCents}`);
  }
  report(codes("t3").includes("duplicate_paid_payments") && classify("t3")?.stage === "confirmed" && classify("t3")?.paidCents === 30000,
    "U4 gilir staf: t3 (dua bil + bank dibayar) confirmed dengan bendera \"Multiple paid payments\"", codes("t3").join(","));
  report(classify("t1")?.stage === "confirmed" && !codes("t1").includes("paid_not_confirmed") && !codes("t1").includes("duplicate_paid_payments"),
    "U4 gilir staf: t1 selepas peruntukan admin -- confirmed, tanpa bendera palsu", codes("t1").join(","));
  report(classify("t7")?.stage === "failed" && classify("t7")?.paidCents === null,
    "U4 gilir staf: t7 (konflik txn) tidak dikira sebagai wang diterima", `${classify("t7")?.stage} ${classify("t7")?.paidCents}`);

  // T16: the unchanged PKG-1c checks on PKG-1d-A. Exactly the two named intentional changes may differ; everything else
  // (capacity, holds, retries, D7, manual, rollback, duplicates, invariants, staff queue) must still pass.
  const onA = runChecksSafe(pkg1cChecks);
  const changed = failedNames(onA).sort();
  report(onA.results.length === pkg1cBase.results.length, `T16 semakan PKG-1c dijalankan semula atas PKG-1d-A: bilangan sama (${onA.results.length})`);
  report(JSON.stringify(changed) === JSON.stringify([...SUPERSEDED].sort()),
    `T16 hanya dua perubahan sengaja yang dinamakan berbeza (D6, D8); ${onA.results.length - changed.length} semakan PKG-1c lain lulus`, changed.join("; "));

  // T25: rollback to the exact previous bodies (callback before guard), then re-apply.
  psql(ROLLBACK_SQL);
  report(JSON.stringify(md5s()) === JSON.stringify(PINNED), "T25 rollback: keempat-empat badan sebelumnya dipulihkan tepat (md5)", JSON.stringify(md5s()));
  report(JSON.stringify(grants()) === JSON.stringify(LIVE_GRANTEES) && triggerAttached(), "T25 rollback: hak EXECUTE dan trigger tidak berubah");
  const rolledPkg1c = runChecksSafe(pkg1cChecks);
  report(rolledPkg1c.results.length === pkg1cBase.results.length && rolledPkg1c.results.every((r) => r.ok), "T25 rollback: tingkah laku PKG-1c penuh kembali (semua semakan PKG-1c lulus)", failedNames(rolledPkg1c).join("; "));
  const rolledOwn = runChecksSafe(ownChecks);
  report(failedNames(rolledOwn).some((n) => n.startsWith("T1 ")), "T25 rollback: tingkah laku lama kembali (T1 gagal: bayaran lewat pada failed diabaikan)");
  applyAll();
  report(JSON.stringify(md5s()) === JSON.stringify(applied), "T25 guna semula selepas rollback: badan sama");
  const again = runChecks(ownChecks);
  report(again.results.length === run.results.length && again.results.every((r) => r.ok), "T25 guna semula: semua semakan T/U lulus semula", failedNames(again).join("; "));

  // Concurrency. These commit their race fixtures, so they run after every check that inspects all rows.
  // PKG-1c D4 capacity race, both payment paths, on top of PKG-1d-A.
  for (const mode of ["callback", "manual"] as const) {
    const r = await capacityRace(mode);
    report(r.a === "confirmed" && r.b === "paid_unallocated" && r.waited && r.enrolled === 1 && r.capacity === 1 && r.paid === 2,
      `Keserasian PKG-1c D4 (${mode}) atas PKG-1d-A: A confirmed, B menunggu kunci jadual -> paid_unallocated, 1/1, 2 bayaran paid`, JSON.stringify(r));
  }
  // T17-T19.
  const t17 = await lateRace();
  report(t17.a === "reconciliation_required", "T17 sesi A (bil lama A dibayar lewat): reconciliation_required", t17.a);
  report(t17.lockRel === "public_registrations", "T17 sesi B menunggu kunci PENDAFTARAN dahulu (urutan kunci registration -> attempt)", t17.lockRel);
  report(t17.b === "reconciliation_required" && t17.bMs >= 2500, "T17 sesi B selepas A commit: B dibatalkan oleh A, kejayaannya direkod (tiada yang hilang)", `${t17.b} ${t17.bMs}ms`);
  report(t17.paid === 2 && t17.enrolled === 0 && t17.payment === "paid", "T17 dua rekod wang, tiada kerusi automatik, pendaftaran paid", JSON.stringify(t17));
  const t18 = await expireRace();
  report(!/ERR|deadlock/i.test(t18.a + t18.b) && t18.b === "reconciliation_required" && t18.bMs >= 2500,
    "T18 callback serentak dengan expire: menunggu, tiada kebuntuan, kejayaan direkod", `${t18.b} ${t18.bMs}ms`);
  report(/^paid\/TXN-race\d+x\/100\.00\|expired\/paid\//.test(t18.att), "T18 keadaan akhir konsisten: percubaan paid, pendaftaran expired/paid", t18.att);
  const t19 = await allocationRace();
  report(t19.a === "confirmed" && t19.b === "paid_unallocated" && t19.bMs >= 2500 && t19.enrolled === 1 && t19.capacity === 1,
    "T19 peruntukan admin serentak dengan callback untuk kerusi terakhir: satu peruntukan, <= kapasiti", JSON.stringify(t19));

  // M1-M12: negative mutations, each applied and then caught.
  let caught = 0;
  for (const m of MUTATIONS) {
    const original = migrationSql[m.file];
    if (!original.includes(m.from)) { report(false, `${m.id} ${m.name}: teks sasaran mutasi tidak ditemui (tidak dikira)`); continue; }
    try { psql(original.replace(m.from, m.to)); } catch (error) { report(false, `${m.id} ${m.name}: mutasi tidak dapat digunakan (tidak dikira)`, (error as Error).message.split("\n")[0]); continue; }
    if (md5s()[m.file === "a1" ? "guard" : m.file === "a2" ? "cb" : m.file === "a3" ? "verify" : "begin"] === applied[m.file === "a1" ? "guard" : m.file === "a2" ? "cb" : m.file === "a3" ? "verify" : "begin"]) {
      report(false, `${m.id} ${m.name}: badan tidak berubah selepas mutasi (tidak dikira)`); psql(original); continue;
    }
    let detected = false;
    let detail = "";
    if (m.race) {
      const r = await lateRace();
      detected = r.lockRel !== "public_registrations" || r.b !== "reconciliation_required" || r.paid !== 2;
      detail = JSON.stringify(r);
    } else {
      const res = runChecksSafe(ownChecks);
      detected = failedNames(res).length > 0;
      detail = failedNames(res).slice(0, 2).join("; ");
    }
    if (detected) caught += 1;
    report(detected, `${m.id} ${m.name}: ditolak oleh ujian`, detail);
    if (detected) console.log(`      dikesan oleh: ${detail.slice(0, 160)}`);
    psql(original);
  }
  report(caught === MUTATIONS.length, `${caught}/${MUTATIONS.length} mutasi DB ditolak`);
  report(JSON.stringify(md5s()) === JSON.stringify(applied), "akhir: badan PKG-1d-A dipulihkan selepas mutasi");
} finally {
  try { docker(["rm", "-f", container]); } catch { /* container may not exist */ }
}

console.log(failures ? `\n${failures} semakan GAGAL` : "\nSemua semakan kontrak DB PKG-1d-A lulus");
process.exit(failures ? 1 : 0);
