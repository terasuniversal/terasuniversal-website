import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { classifyRegistration, type PaymentInput, type RegistrationInput } from "../lib/registrations/reviewQueue.ts";

// Verifies 20261122110000_public_registration_capacity_safe_finalization.sql (PKG-1c) against an isolated, disposable
// local PostgreSQL (the Supabase Postgres image) bootstrapped from Baseline V3 + 20261106090000 + PKG-1. It never
// connects to Supabase, Staging or Production, uses synthetic fixtures only, and removes its container on exit.
// D1-D11 run in scripts/pkg1c-capacity-finalization-db-contract.sql; this runner adds D4 (two concurrent sessions for
// the last seat), D12 (privileges preserved), D13 (rollback to the exact previous bodies and re-apply) and D14
// (negative mutations of the migration must be caught).
const root = new URL("..", import.meta.url);
const image = "public.ecr.aws/supabase/postgres:17.6.1.166";
const container = `teras-pkg1c-capacity-db-${process.pid}`;
const predecessors = [
  "supabase/migrations/20261106090000_public_registration_positive_fee_only.sql",
  "supabase/migrations/20261122100000_revoke_public_execute_registration_rpcs.sql",
];
const migration = "supabase/migrations/20261122110000_public_registration_capacity_safe_finalization.sql";
// Bodies captured from Staging and Production on 21 Nov 2026 (md5 of pg_get_functiondef without whitespace).
const LIVE_MD5 = { crm: "2cc828a6b557f110062eebacc7a455b4", cb: "b696be946aef6dcd821774a4d76f8a09" };
// Live privileges on 21 Nov 2026 (identical on Staging and Production).
const LIVE_GRANTEES = { crm: "authenticated,postgres,service_role", cb: "postgres,service_role", verify: "authenticated,postgres,service_role" };
const CRM = "public.finalize_public_registration_crm(uuid)";
const CB = "public.finalize_public_registration_payment_from_callback(uuid,text,numeric,text,timestamptz,jsonb)";
const VERIFY = "public.verify_public_registration_manual_payment(text,text,numeric,text,text,uuid)";

if (process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || process.env.SUPABASE_URL) {
  throw new Error("Refusing database test: external database environment variables are set");
}

const docker = (args: string[], input?: string): string => execFileSync("docker", args, {
  cwd: root,
  input,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
  stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  env: { ...process.env, MSYS_NO_PATHCONV: "1" },
});
const PSQL = ["exec", "-i", container, "psql", "-v", "ON_ERROR_STOP=1", "-qAt", "-U", "supabase_admin", "-h", "127.0.0.1", "-d", "postgres"];
const psql = (sql: string): string => {
  try { return docker(PSQL, sql); } catch (error) {
    const details = error as { stdout?: string; stderr?: string };
    throw new Error(`${details.stdout ?? ""}${details.stderr ?? ""}`);
  }
};
// A concurrent psql session; resolves (never rejects, so no unhandled rejection can skip container clean-up) with its
// output, wall-clock duration and any error text.
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
const contractSql = read("scripts/pkg1c-capacity-finalization-db-contract.sql");
const helpersSql = contractSql.slice(contractSql.indexOf("-- @@helpers"), contractSql.indexOf("-- @@checks"));
const checksSql = contractSql.slice(contractSql.indexOf("-- @@checks"));
const migrationSql = read(migration);

let failures = 0;
const report = (ok: boolean, name: string, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "LULUS" : "GAGAL"} ${name}${detail && !ok ? ` -> ${detail}` : ""}`);
};

const md5 = (fn: string) => psql(`select md5(regexp_replace(pg_get_functiondef('${fn}'::regprocedure), '\\s+', '', 'g'));`).trim();
const grantees = (fn: string) => psql(`select string_agg(distinct a.grantee::regrole::text, ',' order by a.grantee::regrole::text)
  from pg_proc p, lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  where p.oid = '${fn}'::regprocedure and a.privilege_type = 'EXECUTE';`).trim();
const otherBodies = () => psql(`select string_agg(p.oid::regprocedure::text || '=' || md5(regexp_replace(pg_get_functiondef(p.oid), '\\s+', '', 'g')), ';' order by p.oid::regprocedure::text)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where ((n.nspname = 'public' and (p.proname like '%public_registration%' or p.proname in ('log_event_as_service')))
     or (n.nspname = 'app' and p.proname in ('sync_schedule_seats', 'public_registration_state_guard', 'public_registration_payment_state_guard', 'toyyibpay_system_actor')))
    and p.proname not in ('finalize_public_registration_crm', 'finalize_public_registration_payment_from_callback');`).trim();

interface CheckRun { results: { ok: boolean; name: string; detail: string }[]; queue: Map<string, { reg: RegistrationInput; payments: PaymentInput[] }> }
const runChecks = (): CheckRun => {
  const out = psql(`begin;\n${checksSql}\nrollback;\n`);
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
const runChecksSafe = (): CheckRun => { try { return runChecks(); } catch (error) { return { results: [{ ok: false, name: "pelaksanaan semakan SQL", detail: (error as Error).message.split("\n")[0] }], queue: new Map() }; } };
const failedNames = (run: CheckRun) => run.results.filter((r) => !r.ok).map((r) => r.name);

// D4: two sessions finalize the last seat at the same time. Session A takes the schedule lock and holds its transaction
// open; session B must wait for that lock, then see A's committed enrolment and end paid_unallocated.
let raceNo = 0;
const race = async (mode: "callback" | "manual"): Promise<{ a: string; b: string; bWaited: boolean; waitedOnLock: boolean; enrolled: number; capacity: number; paid: number }> => {
  raceNo += 1;
  const k = `race${raceNo}${mode[0]}`;
  psql(`do $$ declare s uuid; r1 uuid; r2 uuid; begin
    s := pkg1c_t.schedule('${k}', 1);
    r1 := pkg1c_t.reg(s, '${k}a'); perform pkg1c_t.bill(r1, '${k}a'); perform pkg1c_t.expire_hold(r1);
    r2 := pkg1c_t.reg(s, '${k}b'); ${mode === "callback" ? `perform pkg1c_t.bill(r2, '${k}b');` : ""} perform pkg1c_t.expire_hold(r2);
  end $$;`);
  const second = mode === "callback" ? `select pkg1c_t.cb('${k}b');`
    : `select pkg1c_t.manual((select r.id from public.public_registrations r join public.public_registration_attendees a on a.registration_id = r.id where a.email = '${k}b-1@example.invalid'), '${k}b');`;
  const sessionA = session(`begin;\nselect pkg1c_t.cb('${k}a');\nselect pg_sleep(4);\ncommit;\n`);
  await sleep(1200);
  const sessionB = session(`${second}\n`);
  await sleep(1500);
  const waiting = Number(psql(`select count(*) from pg_stat_activity where wait_event_type = 'Lock' and query like '%pkg1c_t.%' and query not like '%pg_stat_activity%';`).trim());
  const [a, b] = await Promise.all([sessionA, sessionB]);
  const facts = psql(`select pkg1c_t.enrolled(cs.id) || '|' || cs.capacity || '|' ||
      (select count(*) from public.public_registration_payments p join public.public_registrations r on r.id = p.registration_id where r.schedule_id = cs.id and p.status = 'paid')
    from public.course_schedules cs join public.courses c on c.id = cs.course_id where c.slug = 'synthetic-pkg1c-${k}';`).trim().split("|").map(Number);
  return { a: a.out.trim().split("\n")[0], b: b.out.trim().split("\n")[0], bWaited: b.ms >= 1500, waitedOnLock: waiting >= 1, enrolled: facts[0], capacity: facts[1], paid: facts[2] };
};

// D14: each mutation weakens one guarantee; the D-suite (or the race) must catch it.
const MUTATIONS: { name: string; from: string; to: string; race?: boolean }[] = [
  { name: "M1 semakan kapasiti dibuang", from: "if v_schedule.capacity is null or v_used + v_held + v_needed > v_schedule.capacity then", to: "if false then" },
  { name: "M2 pegangan sendiri turut dikira", from: "    and pr.id <> v_registration.id\n", to: "" },
  { name: "M3 raise dan bukannya paid_unallocated", from: "    return jsonb_build_object(\n      'outcome', 'paid_unallocated',", to: "    raise exception 'capacity_exceeded' using errcode = 'P0001';\n    return jsonb_build_object(\n      'outcome', 'paid_unallocated'," },
  { name: "M4 hold tidak dikosongkan", from: "    update public.public_registrations\n    set hold_expires_at = null\n    where id = v_registration.id;\n\n    if auth.uid()", to: "    perform 1;\n\n    if auth.uid()" },
  { name: "M5 peserta yang diperlukan dikira sifar", from: "v_needed := v_registration.attendee_count;", to: "v_needed := 0;" },
  { name: "M6 pegangan aktif orang lain diabaikan", from: "    and pr.hold_expires_at > now();\n  v_needed", to: "    and false;\n  v_needed" },
  { name: "M7 bayaran lewat (processing) tidak ditanda paid", from: "    if v_attempt.status = 'processing' then\n      -- pkg1c_late_success_paid", to: "    if false then\n      -- pkg1c_late_success_paid" },
  { name: "M8 payment_status pendaftaran tidak dikemas kini selepas tamat", from: "        update public.public_registrations\n        set payment_status = 'paid'\n        where id = v_registration.id;\n      end if;", to: "        update public.public_registrations\n        set payment_status = payment_status\n        where id = v_registration.id;\n      end if;" },
  { name: "M9 jejak audit paid_unallocated dibuang", from: "jsonb_build_object('event', 'paid_unallocated'", to: "jsonb_build_object('event', 'other'" },
  { name: "M10 paid_unallocated terus memperuntukkan (fall-through)", from: "    return jsonb_build_object(\n      'outcome', 'paid_unallocated',\n      'registration_reference', v_registration.registration_reference\n    );\n  end if;", to: "  end if;" },
  // Last: the race mutation commits race fixtures (race schedules are excluded from the capacity invariant).
  { name: "M11 kunci jadual dibuang (perlumbaan)", from: "  where id = v_registration.schedule_id\n  for update;", to: "  where id = v_registration.schedule_id;", race: true },
];

try {
  try { docker(["image", "inspect", image]); } catch {
    console.log(`TIDAK DAPAT DIUJI: imej ${image} tiada secara setempat (tiada muat turun dibuat).`);
    process.exit(2);
  }
  docker(["run", "-d", "--name", container, "-e", "POSTGRES_PASSWORD=pkg1c_disposable_only", image]);
  for (let attempt = 0; ; attempt += 1) {
    try { docker(["exec", container, "pg_isready", "-U", "postgres", "-h", "127.0.0.1"]); psql("select 1;"); break; }
    catch { if (attempt > 90) throw new Error("Disposable PostgreSQL did not become ready"); await sleep(1000); }
  }

  psql(read("supabase/baseline/v3/bootstrap.sql"));
  for (const file of predecessors) psql(read(file));
  // Mirror the live privileges (Baseline V3 still grants anon EXECUTE on these three; Staging/Production do not).
  psql(`revoke execute on function ${CRM} from anon; revoke execute on function ${CB} from anon, authenticated;
    revoke execute on function ${VERIFY} from anon;`);
  report(grantees(CRM) === LIVE_GRANTEES.crm && grantees(CB) === LIVE_GRANTEES.cb && grantees(VERIFY) === LIVE_GRANTEES.verify,
    "persediaan: hak EXECUTE sama dengan Staging/Production", `${grantees(CRM)} | ${grantees(CB)} | ${grantees(VERIFY)}`);
  report(md5(CRM) === LIVE_MD5.crm && md5(CB) === LIVE_MD5.cb, "persediaan: badan kedua-dua fungsi sama dengan Staging/Production (md5)", `${md5(CRM)} ${md5(CB)}`);
  // Prepared rollback (forward repair): the exact previous definitions, re-created by CREATE OR REPLACE.
  const ROLLBACK_SQL = `${psql(`select pg_get_functiondef('${CRM}'::regprocedure);`).trim()};\n${psql(`select pg_get_functiondef('${CB}'::regprocedure);`).trim()};\n`;
  psql(helpersSql);
  const othersBefore = otherBodies();

  // Before PKG-1c: the defect is real (a late payment overbooks a full session).
  const before = psql(`begin;
    do $$ declare s uuid; a uuid; b uuid; begin
      s := pkg1c_t.schedule('pre', 1);
      a := pkg1c_t.reg(s, 'prea'); perform pkg1c_t.bill(a, 'prea'); perform pkg1c_t.expire_hold(a);
      b := pkg1c_t.reg(s, 'preb'); perform pkg1c_t.bill(b, 'preb'); perform pkg1c_t.cb('preb');
      perform set_config('pkg1c.pre', pkg1c_t.cb('prea') || '|' || pkg1c_t.enrolled(s) || '|' || pkg1c_t.attempt('prea'), false);
    end $$;
    select current_setting('pkg1c.pre');
    rollback;`).trim().split("\n").pop();
  // course_schedules_check (seats_taken <= capacity, live on Staging and Production) stops the overbooking itself, so the
  // whole verified-payment transaction fails and rolls back: the provider-confirmed payment is not recorded at all.
  report(/^ERR:new row for relation "course_schedules" violates check constraint "course_schedules_check"\|1\|processing\/-\/-$/.test(before ?? ""),
    "sebelum PKG-1c: bayaran lewat ke sesi penuh gagal (check_violation) dan bayaran yang disahkan TIDAK direkod (kecacatan dibuktikan)", before);

  psql(migrationSql);
  const appliedMd5 = { crm: md5(CRM), cb: md5(CB) };
  psql(migrationSql); // idempotent: a second run must succeed and change nothing
  report(md5(CRM) === appliedMd5.crm && md5(CB) === appliedMd5.cb, "migrasi idempoten (dijalankan dua kali, badan sama)");
  report(appliedMd5.crm !== LIVE_MD5.crm && appliedMd5.cb !== LIVE_MD5.cb, "migrasi menggantikan kedua-dua badan");
  report(otherBodies() === othersBefore, "tiada fungsi pendaftaran/pembayaran/audit lain berubah");
  // D12: privileges, SECURITY DEFINER and search_path preserved.
  report(grantees(CRM) === LIVE_GRANTEES.crm && grantees(CB) === LIVE_GRANTEES.cb && grantees(VERIFY) === LIVE_GRANTEES.verify,
    "D12 hak EXECUTE tidak berubah (anon tiada; callback service_role sahaja)", `${grantees(CRM)} | ${grantees(CB)}`);
  report(psql(`select string_agg(prosecdef::text || ':' || array_to_string(proconfig, ','), ' ' order by oid) from pg_proc where oid in ('${CRM}'::regprocedure, '${CB}'::regprocedure);`).trim()
    === "true:search_path=pg_catalog, public, app, extensions true:search_path=pg_catalog, public, app"
    || psql(`select string_agg(prosecdef::text || ':' || array_to_string(proconfig, ','), ' ' order by oid desc) from pg_proc where oid in ('${CRM}'::regprocedure, '${CB}'::regprocedure);`).trim()
    === "true:search_path=pg_catalog, public, app, extensions true:search_path=pg_catalog, public, app",
    "D12 SECURITY DEFINER dan search_path dikekalkan");
  report(/permission denied for function finalize_public_registration_crm/.test((() => { try { psql(`set role anon; select public.finalize_public_registration_crm(gen_random_uuid());`); return ""; } catch (e) { return (e as Error).message; } })()),
    "D12 anon terus: 42501 permission denied");

  // D1-D11 (+ rollback, duplicates, invariants, staff queue).
  const run = runChecks();
  for (const r of run.results) report(r.ok, r.name, r.detail);
  if (run.results.length < 60) report(false, "bilangan semakan SQL kurang daripada jangkaan", String(run.results.length));

  // Staff review queue: the real classifier flags every paid-but-unallocated / paid-after-ended row.
  const now = new Date();
  const classify = (k: string) => {
    const row = run.queue.get(k);
    if (!row) return null;
    return classifyRegistration(row.reg, [], row.payments, { known: false, participantIds: new Set() }, now);
  };
  for (const k of ["d3m1", "d3h1", "dm1", "d7c", "d7e"]) {
    const c = classify(k);
    const codes = c?.exceptions.map((e) => e.code) ?? [];
    report(!!c && codes.includes("paid_not_confirmed") && c.needsAttention && !codes.includes("hold_expired_active") && !codes.includes("duplicate_paid_payments") && !codes.includes("amount_mismatch"),
      `Baris gilir staf: ${k} ditanda "Paid, not confirmed" (perlu tindakan), tanpa bendera palsu`, codes.join(","));
  }
  for (const k of ["d1", "d3m2"]) {
    const c = classify(k);
    report(!!c && c.stage === "confirmed" && !c.exceptions.some((e) => e.code === "paid_not_confirmed"), `Baris gilir staf: ${k} (confirmed) tidak ditanda`);
  }

  // D4: concurrency, ToyyibPay vs ToyyibPay and ToyyibPay vs staff bank transfer, for the last seat.
  for (const mode of ["callback", "manual"] as const) {
    const r = await race(mode);
    report(r.a === "confirmed", `D4 (${mode}) sesi A (kunci dahulu): confirmed`, r.a);
    report(r.b === "paid_unallocated", `D4 (${mode}) sesi B serentak: paid_unallocated`, r.b);
    report(r.waitedOnLock && r.bWaited, `D4 (${mode}) sesi B menunggu kunci jadual (pg_stat_activity: Lock) sehingga A commit`, `${r.waitedOnLock} ${r.bWaited}`);
    report(r.enrolled === 1 && r.capacity === 1, `D4 (${mode}) tepat satu peruntukan, tidak melebihi kapasiti 1`, `${r.enrolled}/${r.capacity}`);
    report(r.paid === 2, `D4 (${mode}) kedua-dua bayaran direkod paid (tiada yang dibuang)`, String(r.paid));
  }

  // D13: rollback restores the exact previous bodies and behaviour; re-applying PKG-1c restores the fix.
  psql(ROLLBACK_SQL);
  report(md5(CRM) === LIVE_MD5.crm && md5(CB) === LIVE_MD5.cb, "D13 rollback: badan asal tepat dipulihkan (md5 live)");
  report(grantees(CRM) === LIVE_GRANTEES.crm && grantees(CB) === LIVE_GRANTEES.cb, "D13 rollback: hak EXECUTE tidak berubah");
  const rolled = runChecksSafe();
  report(failedNames(rolled).some((n) => n.startsWith("D3 ")), "D13 rollback: tingkah laku lama kembali (D3 gagal: bayaran lewat ke sesi penuh tidak direkod)");
  psql(migrationSql);
  report(md5(CRM) === appliedMd5.crm && md5(CB) === appliedMd5.cb, "D13 guna semula PKG-1c selepas rollback: badan sama");
  const again = runChecks();
  report(again.results.length === run.results.length && again.results.every((r) => r.ok), "D13 guna semula: semua semakan D lulus semula", failedNames(again).join("; "));

  // D14: negative mutations.
  let caught = 0;
  for (const m of MUTATIONS) {
    if (!migrationSql.includes(m.from)) { report(false, `D14 ${m.name}: teks sasaran mutasi tidak ditemui`); continue; }
    const mutated = migrationSql.replace(m.from, m.to);
    try { psql(mutated); } catch (error) { report(false, `D14 ${m.name}: mutasi tidak dapat digunakan`, (error as Error).message.split("\n")[0]); continue; }
    let detected = false;
    let detail = "";
    if (m.race) {
      const r = await race("callback");
      detected = !(r.a === "confirmed" && r.b === "paid_unallocated" && r.enrolled === 1);
      detail = `${r.a}/${r.b}/${r.enrolled}`;
    } else {
      const res = runChecksSafe();
      detected = failedNames(res).length > 0;
      detail = failedNames(res).slice(0, 2).join("; ");
    }
    if (detected) caught += 1;
    report(detected, `D14 ${m.name}: ditolak oleh ujian`, detail);
    if (detected) console.log(`      dikesan oleh: ${detail}`);
    psql(migrationSql);
  }
  report(caught === MUTATIONS.length, `D14 ${caught}/${MUTATIONS.length} mutasi ditolak`);
  report(md5(CRM) === appliedMd5.crm && md5(CB) === appliedMd5.cb, "akhir: badan PKG-1c dipulihkan selepas mutasi");
} finally {
  try { docker(["rm", "-f", container]); } catch { /* container may not exist */ }
}

console.log(failures ? `\n${failures} semakan GAGAL` : "\nSemua semakan kontrak DB PKG-1c lulus");
process.exit(failures ? 1 : 0);
