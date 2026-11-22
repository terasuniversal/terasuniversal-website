import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";

// PKG-1d-B-DB-G1 contract: M0 (legacy R2 correction), M1a (receiving accounts), M2 (staff_request_id), AF1a/AF1b
// (additional-funds ledger) and M3 (staff bank-transfer RPC). Runs against an isolated, disposable local PostgreSQL
// (Supabase Postgres image) bootstrapped from Baseline V3 + PKG-1 + PKG-1c + PKG-1d-A + R1 A5. It never connects to
// Supabase, Staging, Production or ToyyibPay, uses synthetic fixtures only, and removes its container on exit.
//
// Covers: pinned baselines; idempotent (re-)application; S1-S12, S15, S17, S18 inside BEGIN ... ROLLBACK; S13, S14 and
// S19 with genuinely concurrent committed sessions; negative mutations (each applied, then caught); forward rollback and
// re-application; PKG-1c, PKG-1d-A and R1 checks re-run with exactly the named intentional changes.
const root = new URL("..", import.meta.url);
const image = "public.ecr.aws/supabase/postgres:17.6.1.166";
const container = `teras-dbg1-db-${process.pid}`;
const chain = [
  "supabase/migrations/20261106090000_public_registration_positive_fee_only.sql",
  "supabase/migrations/20261122100000_revoke_public_execute_registration_rpcs.sql",
  "supabase/migrations/20261122110000_public_registration_capacity_safe_finalization.sql",
  "supabase/migrations/20261122120000_public_registration_payment_guard_late_success.sql",
  "supabase/migrations/20261122121000_public_registration_late_success_recording.sql",
  "supabase/migrations/20261122122000_public_registration_manual_payment_states.sql",
  "supabase/migrations/20261122123000_public_registration_begin_payment_paid_guard.sql",
  "supabase/migrations/20261122124000_public_registration_schedule_finalizable_guard.sql",
];
const MIG = {
  m0: "supabase/migrations/20261124100000_public_registration_manual_payment_already_paid_guard.sql",
  m1a: "supabase/migrations/20261124101000_payment_receiving_accounts.sql",
  m2: "supabase/migrations/20261124102000_public_registration_staff_request_id.sql",
  af1a: "supabase/migrations/20261124103000_public_registration_additional_funds.sql",
  af1b: "supabase/migrations/20261124104000_public_registration_additional_funds_rpcs.sql",
  m3: "supabase/migrations/20261124105000_public_registration_staff_bank_transfer_rpc.sql",
} as const;
const FN = {
  cb: "public.finalize_public_registration_payment_from_callback(uuid,text,numeric,text,timestamptz,jsonb)",
  legacy: "public.verify_public_registration_manual_payment(text,text,numeric,text,text,uuid)",
  crm: "public.finalize_public_registration_crm(uuid)",
  staff: "public.verify_public_registration_bank_transfer_by_staff(uuid,uuid,numeric,text,uuid,text)",
  claim: "public.record_public_registration_additional_funds_claim(uuid,uuid,numeric,date,text,uuid,text)",
  decide: "public.decide_public_registration_additional_funds(uuid,text,uuid,text)",
} as const;
// Full md5 baselines, verified read-only on canonical Staging eokiaehnvzbggmacifcf on 22 Nov 2026.
const PINNED: Record<string, string> = {
  [FN.cb]: "4bfacda586181a3aacd7c8e02b4c7362",
  [FN.legacy]: "b13e9b7ff5d3c8ebf1be8443aa21fa0a",
  [FN.crm]: "fe568112a7c9a2ae8ad765557dc5f8c6",
  "app.public_registration_payment_state_guard()": "b2a2c84993b50291b443bff288d8217d",
  "app.public_registration_state_guard()": "b3df8771aaa6958733bb00ed8426d512",
  "app.is_admin()": "8f41288452b95115c01f55d50e2dae10",
  "app.audit_trigger()": "03d73e4e8142039f07e663afb4645d08",
  "public.log_event_as_service(uuid,text,public.audit_action,text,text,text,jsonb)": "7cc35bc1dffad1864edde3674dee81c5",
};
const M0_MD5 = "89f34994a0e83a9b12e87e07a456b1cb";
// Checks of earlier contracts whose behaviour changes on purpose with M0 (R2 closed: no second money record on an
// already-paid registration). Nothing else may change.
const PKG1D_CHANGED = [
  "T13 pindahan bank pada pendaftaran confirmed yang sudah dibayar: already_confirmed",
  "T13 rekod wang ketiga direkod, kerusi kekal 1",
];
const R1_CHANGED = ["R1 dua rekod wang berasingan pada satu pendaftaran: kedua-dua direkod, dua audit, tiada kerusi"];

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
const first = (s: string) => s.trim().split("\n")[0] ?? "";

const pkg1cSql = read("scripts/pkg1c-capacity-finalization-db-contract.sql");
const pkg1dSql = read("scripts/pkg1d-a-payment-integrity-db-contract.sql");
const dbg1Sql = read("scripts/pkg1d-b-db-staff-bank-transfer-db-contract.sql");
const r1Mts = read("scripts/r1-schedule-finalization-db-contract.mts");
const r1Start = r1Mts.indexOf("const R1_CHECKS = `") + "const R1_CHECKS = `".length;
const R1_CHECKS = r1Mts.slice(r1Start, r1Mts.indexOf("\n`;", r1Start)).replace(/\\\\/g, "\\");
const SRC = Object.fromEntries(Object.entries(MIG).map(([k, p]) => [k, read(p)])) as Record<keyof typeof MIG, string>;

let failures = 0;
const report = (ok: boolean, name: string, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "LULUS" : "GAGAL"} ${name}${detail && !ok ? ` -> ${detail}` : ""}`);
};
const md5 = (fn: string) => psql(`select md5(regexp_replace(pg_get_functiondef('${fn}'::regprocedure), '\\s+', '', 'g'));`).trim();
const acl = (fn: string) => psql(`select coalesce(proacl::text, 'null') from pg_proc where oid = '${fn}'::regprocedure;`).trim();
const allBodies = () => psql(`select string_agg(p.oid::regprocedure::text || '=' || md5(regexp_replace(pg_get_functiondef(p.oid), '\\s+', '', 'g')) || ':' || coalesce(p.proacl::text, '-'), ';' order by p.oid::regprocedure::text)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'app') and p.prokind = 'f'
    and p.proname not in ('verify_public_registration_manual_payment', 'verify_public_registration_bank_transfer_by_staff',
      'record_public_registration_additional_funds_claim', 'decide_public_registration_additional_funds',
      'payment_receiving_account_guard', 'public_registration_payment_receiving_account_guard',
      'public_registration_payment_staff_request_guard', 'public_registration_additional_funds_guard');`).trim();

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
const failed = (run: Run) => run.results.filter((r) => !r.ok).map((r) => r.name).sort();
const same = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const dbg1Checks = section(dbg1Sql, "-- @@checks");
const pkg1cChecks = section(pkg1cSql, "-- @@checks");
const pkg1dChecks = section(pkg1dSql, "-- @@checks");
const applyAll = () => { for (const k of Object.keys(MIG) as (keyof typeof MIG)[]) psql(SRC[k]); };

// Committed fixtures for the concurrency scenarios (unique keys per run).
let fx = 0;
const one = (sql: string) => psql(sql).trim().split("\n").pop()!.trim();
const fixture = (opts: { cap?: number; bill?: boolean; paid?: boolean; regs?: number; expire?: boolean } = {}) => {
  const k = `g1race${process.pid}x${++fx}`;
  const ids = one(`do $$ declare s uuid; r uuid; i integer; begin
      s := pkg1c_t.schedule('${k}', ${opts.cap ?? 5});
      for i in 1..${opts.regs ?? 1} loop
        r := pkg1c_t.reg(s, '${k}r' || i);
        ${opts.expire ? "perform pkg1c_t.expire_hold(r);" : ""}
        ${opts.bill ? `perform pkg1c_t.bill(r, '${k}r' || i);` : ""}
        ${opts.paid ? `perform pkg1c_t.cb('${k}r' || i);` : ""}
      end loop; end $$;
    select string_agg(r.id::text, ',' order by r.created_at) || '|' || max(r.schedule_id::text)
    from public.public_registrations r join public.course_schedules cs on cs.id = r.schedule_id join public.courses c on c.id = cs.course_id
    where c.slug = 'synthetic-pkg1c-${k}';`);
  const [regs, s] = ids.split("|");
  return { k, regs: regs.split(","), s };
};
const lockedRelation = (marker: string) => psql(`select coalesce(string_agg(distinct l.relation::regclass::text, ','), '-') from pg_locks l
  join pg_stat_activity a on a.pid = l.pid where l.locktype = 'tuple' and a.query like '%${marker.replace(/'/g, "''")}%' and a.query not like '%pg_locks%';`).trim();
// The waiting session (by its statement text) is blocked by a transaction that holds a row-level write lock on the given
// relation (an UPDATE in progress shows as RowExclusiveLock; the waiter waits on that transaction id).
const blockedBy = (waiter: string, relation: string) => psql(`select exists (select 1 from pg_stat_activity w, pg_locks hl
  where w.query like '%${waiter.replace(/'/g, "''")}%' and w.query not like '%pg_stat_activity%' and w.wait_event_type = 'Lock'
    and hl.pid = any(pg_blocking_pids(w.pid)) and hl.granted and hl.mode = 'RowExclusiveLock' and hl.relation = '${relation}'::regclass);`).trim() === "t";
const count = (sql: string) => Number(one(sql));
const bankCount = (reg: string) => count(`select count(*) from public.public_registration_payments where registration_id = '${reg}' and payment_provider = 'bank_transfer';`);
const paidCount = (reg: string) => count(`select count(*) from public.public_registration_payments where registration_id = '${reg}' and status = 'paid';`);
const staffSql = (reg: string, ref: string, req: string, as = "00000000-0000-0000-0000-00000000a001", acct = "SYN-A") =>
  `select dbg1_t.staff('${reg}', '${acct}', '${ref}', '${req}'::uuid, p_as => '${as}');`;

// S13: two staff members verifying at the same time.
const s13 = async () => {
  const out: Record<string, unknown> = {};
  // (a) same registration, different request UUIDs, two admins.
  let f = fixture();
  let a = session(`begin;\n${staffSql(f.regs[0], "RACE-A", "11111111-0000-0000-0000-00000000000a")}\nselect pg_sleep(4);\ncommit;\n`);
  await sleep(1200);
  let b = session(`${staffSql(f.regs[0], "RACE-B", "11111111-0000-0000-0000-00000000000b", "00000000-0000-0000-0000-00000000b001", "SYN-B")}\n`);
  await sleep(1300);
  const relA = lockedRelation("RACE-B");
  let [ra, rb] = await Promise.all([a, b]);
  out.a = { a: first(ra.out), b: first(rb.out), bMs: rb.ms, rel: relA, bank: bankCount(f.regs[0]), paid: paidCount(f.regs[0]),
    enrolled: count(`select pkg1c_t.enrolled('${f.s}');`) };
  // (b) same registration, same request UUID.
  f = fixture();
  a = session(`begin;\n${staffSql(f.regs[0], "RACE-SAME", "22222222-0000-0000-0000-00000000000a")}\nselect pg_sleep(4);\ncommit;\n`);
  await sleep(1200);
  b = session(`${staffSql(f.regs[0], "RACE-SAME", "22222222-0000-0000-0000-00000000000a", "00000000-0000-0000-0000-00000000b001")}\n`);
  [ra, rb] = await Promise.all([a, b]);
  out.b = { a: first(ra.out), b: first(rb.out), bMs: rb.ms, bank: bankCount(f.regs[0]) };
  // (c) different registrations, same request UUID.
  f = fixture({ regs: 2 });
  a = session(`begin;\n${staffSql(f.regs[0], "RACE-C1", "33333333-0000-0000-0000-00000000000a")}\nselect pg_sleep(4);\ncommit;\n`);
  await sleep(1200);
  b = session(`${staffSql(f.regs[1], "RACE-C2", "33333333-0000-0000-0000-00000000000a", "00000000-0000-0000-0000-00000000b001")}\n`);
  [ra, rb] = await Promise.all([a, b]);
  out.c = { a: first(ra.out), b: first(rb.out), bMs: rb.ms, bank1: bankCount(f.regs[0]), bank2: bankCount(f.regs[1]) };
  // (d) the last seat: two registrations without holds, capacity 1.
  f = fixture({ cap: 1, regs: 2, expire: true });
  a = session(`begin;\n${staffSql(f.regs[0], "RACE-D1", "44444444-0000-0000-0000-00000000000a")}\nselect pg_sleep(4);\ncommit;\n`);
  await sleep(1200);
  b = session(`${staffSql(f.regs[1], "RACE-D2", "44444444-0000-0000-0000-00000000000b", "00000000-0000-0000-0000-00000000b001")}\n`);
  await sleep(1300);
  const relD = lockedRelation("RACE-D2");
  [ra, rb] = await Promise.all([a, b]);
  out.d = { a: first(ra.out), b: first(rb.out), bMs: rb.ms, waitOn: relD, taken: count(`select pkg1c_t.taken('${f.s}');`),
    enrolled: count(`select pkg1c_t.enrolled('${f.s}');`), paid: paidCount(f.regs[0]) + paidCount(f.regs[1]) };
  return out as Record<"a" | "b" | "c" | "d", Record<string, unknown>>;
};

// S14: ToyyibPay callback and staff verification at the same time.
const s14 = async () => {
  const out: Record<string, unknown> = {};
  // (a) staff commits first; the callback then takes the late-success path.
  let f = fixture({ bill: true });
  let a = session(`begin;\n${staffSql(f.regs[0], "RACE-S14A", "55555555-0000-0000-0000-00000000000a")}\nselect pg_sleep(4);\ncommit;\n`);
  await sleep(1200);
  let b = session(`select pkg1c_t.cb('${f.k}r1');\n`);
  await sleep(1300);
  const relA = lockedRelation(`pkg1c_t.cb('${f.k}r1')`);
  let [ra, rb] = await Promise.all([a, b]);
  out.a = { staff: first(ra.out), cb: first(rb.out), cbMs: rb.ms, rel: relA, paid: paidCount(f.regs[0]), bank: bankCount(f.regs[0]),
    enrolled: count(`select pkg1c_t.enrolled('${f.s}');`),
    late: one(`select coalesce(raw_response->>'late_success_reconciliation_required', '-') from public.public_registration_payments where registration_id = '${f.regs[0]}' and payment_provider = 'toyyibpay';`) };
  // (b) the callback commits first; staff then gets the additional-funds review with nothing written.
  f = fixture({ bill: true });
  a = session(`begin;\nselect pkg1c_t.cb('${f.k}r1');\nselect pg_sleep(4);\ncommit;\n`);
  await sleep(1200);
  b = session(`${staffSql(f.regs[0], "RACE-S14B", "55555555-0000-0000-0000-00000000000b")}\n`);
  [ra, rb] = await Promise.all([a, b]);
  out.b = { cb: first(ra.out), staff: first(rb.out), staffMs: rb.ms, paid: paidCount(f.regs[0]), bank: bankCount(f.regs[0]),
    enrolled: count(`select pkg1c_t.enrolled('${f.s}');`) };
  // (c) the schedule is cancelled in a transaction that commits while staff verification waits.
  f = fixture();
  a = session(`begin;\nupdate public.course_schedules set status = 'cancelled' where id = '${f.s}';\nselect pg_sleep(4);\ncommit;\n`);
  await sleep(1200);
  b = session(`${staffSql(f.regs[0], "RACE-S14C", "55555555-0000-0000-0000-00000000000c")}\n`);
  await sleep(1300);
  const relC = lockedRelation("RACE-S14C");
  const blockedC = blockedBy("RACE-S14C", "public.course_schedules");
  [ra, rb] = await Promise.all([a, b]);
  out.c = { staff: first(rb.out), staffMs: rb.ms, waitOn: relC, blockedByCancellation: blockedC,
    bank: one(`select status || '/' || coalesce(raw_response->'schedule_not_finalizable'->>'schedule_status', '-') from public.public_registration_payments where registration_id = '${f.regs[0]}' and payment_provider = 'bank_transfer';`),
    enrolled: count(`select pkg1c_t.enrolled('${f.s}');`) };
  return out as Record<"a" | "b" | "c", Record<string, unknown>>;
};

// S19: additional-funds claims and decisions at the same time.
const s19 = async () => {
  const out: Record<string, unknown> = {};
  let f = fixture({ bill: true, paid: true });
  const claimSql = (req: string, as = "00000000-0000-0000-0000-00000000a001") =>
    `select dbg1_t.claim('${f.regs[0]}', 'SYN-A', 25, 'RACE-AF', '${req}'::uuid, p_as => '${as}');`;
  let a = session(`begin;\n${claimSql("66666666-0000-0000-0000-00000000000a")}\nselect pg_sleep(4);\ncommit;\n`);
  await sleep(1200);
  let b = session(`${claimSql("66666666-0000-0000-0000-00000000000a", "00000000-0000-0000-0000-00000000b001")}\n`);
  let [ra, rb] = await Promise.all([a, b]);
  out.a = { a: first(ra.out), b: first(rb.out), bMs: rb.ms,
    rows: count(`select count(*) from public.public_registration_additional_funds where registration_id = '${f.regs[0]}';`),
    events: count(`select count(*) from public.audit_logs where metadata->>'event' = 'additional_funds_claimed' and metadata->>'request_id' = '66666666-0000-0000-0000-00000000000a';`) };
  f = fixture({ bill: true, paid: true });
  psql(`select dbg1_t.claim('${f.regs[0]}', 'SYN-B', 15, 'RACE-AF2', '77777777-0000-0000-0000-00000000000a'::uuid);`);
  const af = one(`select id from public.public_registration_additional_funds where claim_request_id = '77777777-0000-0000-0000-00000000000a';`);
  a = session(`begin;\nselect dbg1_t.decide('${af}', 'verified', '77777777-0000-0000-0000-0000000000d1'::uuid, p_as => '00000000-0000-0000-0000-00000000b001');\nselect pg_sleep(4);\ncommit;\n`);
  await sleep(1200);
  b = session(`select dbg1_t.decide('${af}', 'rejected', '77777777-0000-0000-0000-0000000000d2'::uuid, p_as => '00000000-0000-0000-0000-00000000b002');\n`);
  [ra, rb] = await Promise.all([a, b]);
  out.b = { a: first(ra.out), b: first(rb.out), bMs: rb.ms, status: one(`select status from public.public_registration_additional_funds where id = '${af}';`),
    verified: count(`select count(*) from public.audit_logs where entity_id = '${af}' and metadata->>'event' = 'additional_funds_verified';`),
    rejected: count(`select count(*) from public.audit_logs where entity_id = '${af}' and metadata->>'event' = 'additional_funds_rejected';`) };
  return out as Record<"a" | "b", Record<string, unknown>>;
};
const s13ok = (r: Awaited<ReturnType<typeof s13>>) => r.a.a === "confirmed|-" && r.a.b === "additional_funds_review|registration_already_paid"
  && Number(r.a.bMs) >= 2500 && String(r.a.rel).includes("public_registrations") && r.a.bank === 1 && r.a.paid === 1 && r.a.enrolled === 1;

// Negative mutations: each applied, the relevant checks must fail, then the original is restored.
type Mutation = { id: string; name: string; key?: keyof typeof MIG; find?: string; repl?: string; sql?: string; restore?: string; detect: "checks" | "race" };
const MUTATIONS: Mutation[] = [
  { id: "X1", name: "M3: semakan peranan dibuang", key: "m3", find: "if v_verifier_id is null or not app.is_admin() then", repl: "if v_verifier_id is null then", detect: "checks" },
  { id: "X2", name: "M3: EXECUTE dibuka kepada anon dan service_role", sql: `grant execute on function ${FN.staff} to anon, service_role;`,
    restore: `revoke execute on function ${FN.staff} from anon, service_role;`, detect: "checks" },
  { id: "X3", name: "M3: semakan akaun penerima aktif dibuang", key: "m3", find: "where id = p_receiving_bank_account_id and is_active and deleted_at is null;", repl: "where id = p_receiving_bank_account_id;", detect: "checks" },
  { id: "X4", name: "M3: semakan amaun dibuang", key: "m3", find: "if round(p_amount, 2) <> round(v_registration.amount_snapshot, 2) then", repl: "if false then", detect: "checks" },
  { id: "X5", name: "M3: semakan nota dibuang", key: "m3", find: "if length(v_notes) > 500 or length(regexp_replace(v_notes, '[^[:alnum:]]', '', 'g')) < 5 then", repl: "if false then", detect: "checks" },
  { id: "X6", name: "M3: pendaftaran sudah dibayar menerima rekod bayaran kedua", key: "m3", find: "if v_registration.payment_status = 'paid' or cardinality(v_paid) > 0 then", repl: "if false then", detect: "checks" },
  { id: "X7", name: "M3: supersede ToyyibPay dibuang", key: "m3", find: "if cardinality(v_superseded) > 0 then", repl: "if false then", detect: "checks" },
  { id: "X8", name: "M3: FOR UPDATE pada pendaftaran dibuang (perlumbaan)", key: "m3",
    find: "select * into v_registration from public.public_registrations where id = p_registration_id for update;", repl: "select * into v_registration from public.public_registrations where id = p_registration_id;", detect: "race" },
  { id: "X9", name: "M3: blok R1 dilumpuhkan", key: "m3", find: "  if not found or v_schedule_status in ('cancelled', 'completed') then", repl: "  if false then", detect: "checks" },
  { id: "X10", name: "M3: pengendali EXCEPTION luas di sekeliling CRM", key: "m3", find: "  return public.finalize_public_registration_crm(v_registration.id);\nend;",
    repl: "  begin\n    return public.finalize_public_registration_crm(v_registration.id);\n  exception when others then\n    return jsonb_build_object('outcome', 'reconciliation_required');\n  end;\nend;", detect: "checks" },
  { id: "X11", name: "M3: idempotensi staff_request_id dibuang", key: "m3", find: "where staff_request_id = p_request_id for update;", repl: "where false;", detect: "checks" },
  { id: "X12", name: "AF1a: pengawal dana tambahan dilumpuhkan", key: "af1a", find: "as $function$\nbegin\n  if tg_op = 'DELETE' then\n    raise exception 'additional_funds_delete_forbidden'",
    repl: "as $function$\nbegin\n  if tg_op = 'DELETE' then return old; end if;\n  return new;\n  if tg_op = 'DELETE' then\n    raise exception 'additional_funds_delete_forbidden'", detect: "checks" },
  { id: "X13", name: "AF1b: semakan four-eyes dalam RPC dibuang", key: "af1b", find: "if v_row.claimed_by = v_actor then", repl: "if false then", detect: "checks" },
  { id: "X14", name: "AF1a: kekangan CHECK four-eyes dibuang", sql: "alter table public.public_registration_additional_funds drop constraint public_registration_additional_funds_four_eyes;",
    restore: "alter table public.public_registration_additional_funds add constraint public_registration_additional_funds_four_eyes check (decided_by is null or decided_by <> claimed_by);", detect: "checks" },
  { id: "X15", name: "AF1b: syarat pendaftaran sudah dibayar dibuang", key: "af1b", find: "if cardinality(v_paid) = 0 then", repl: "if false then", detect: "checks" },
  { id: "X16", name: "AF1a: kekangan unik claim_request_id dibuang", sql: "alter table public.public_registration_additional_funds drop constraint public_registration_additional_funds_claim_request_key;",
    restore: "alter table public.public_registration_additional_funds add constraint public_registration_additional_funds_claim_request_key unique (claim_request_id);", detect: "checks" },
  { id: "X17", name: "M0: pengawal R2 dibuang", key: "m0", find: "if (v_payment.id is null or v_payment.status <> 'paid')", repl: "if false and (v_payment.id is null or v_payment.status <> 'paid')", detect: "checks" },
  { id: "X18", name: "M0: supersede ToyyibPay dibuang", key: "m0", find: "if cardinality(v_superseded) > 0 then", repl: "if false then", detect: "checks" },
  { id: "X19", name: "M2: indeks unik staff_request_id dibuang", sql: "drop index public.public_registration_payments_staff_request_key;", restore: SRC_M2_PLACEHOLDER(), detect: "checks" },
  { id: "X20", name: "AF1b: nota keputusan tidak diwajibkan", key: "af1b", find: "  if length(v_notes) > 500 or length(regexp_replace(v_notes, '[^[:alnum:]]', '', 'g')) < 5 then\n    raise exception 'invalid_additional_funds_notes' using errcode = 'P0001';\n  end if;\n\n  -- Lock the claim first",
    repl: "  -- Lock the claim first", detect: "checks" },
];
function SRC_M2_PLACEHOLDER() { return "__M2__"; }

try {
  try { docker(["image", "inspect", image]); } catch {
    console.log(`TIDAK DAPAT DIUJI: imej ${image} tiada secara setempat (tiada muat turun dibuat).`);
    process.exit(2);
  }
  docker(["run", "-d", "--name", container, "-e", "POSTGRES_PASSWORD=dbg1_disposable_only", image]);
  for (let attempt = 0; ; attempt += 1) {
    try { docker(["exec", container, "pg_isready", "-U", "postgres", "-h", "127.0.0.1"]); psql("select 1;"); break; }
    catch { if (attempt > 90) throw new Error("Disposable PostgreSQL did not become ready"); await sleep(1000); }
  }
  psql(read("supabase/baseline/v3/bootstrap.sql"));
  for (const file of chain) psql(read(file));
  // Mirror the live privileges (Baseline V3 still grants anon EXECUTE on these; Staging/Production do not).
  psql(`revoke execute on function ${FN.crm} from anon; revoke execute on function ${FN.cb} from anon, authenticated;
    revoke execute on function ${FN.legacy} from anon;`);
  const pinnedNow = Object.fromEntries(Object.keys(PINNED).map((fn) => [fn, md5(fn)]));
  report(JSON.stringify(pinnedNow) === JSON.stringify(PINNED), "persediaan: md5 penuh 8 objek = garis dasar Staging (22 Nov 2026)", JSON.stringify(pinnedNow));
  const ROLLBACK_LEGACY = `${psql(`select pg_get_functiondef('${FN.legacy}'::regprocedure);`).trim()};`;
  const aclLegacyBefore = acl(FN.legacy);
  psql(section(pkg1cSql, "-- @@helpers", "-- @@checks"));
  psql(section(pkg1dSql, "-- @@helpers", "-- @@checks"));
  const othersBefore = allBodies();

  // Earlier contracts before DB-G1 (on A5).
  const c0 = runChecks(section(pkg1cSql, "-- @@checks"));
  const d0 = runChecks(pkg1dChecks);
  const r0 = runChecks(R1_CHECKS);
  report(c0.results.length >= 60 && d0.results.length >= 40 && r0.results.length >= 30 && d0.results.every((r) => r.ok) && r0.results.every((r) => r.ok),
    `garis dasar sebelum DB-G1: PKG-1c ${c0.results.length} (${failed(c0).length} perubahan bernama A5), PKG-1d-A ${d0.results.length} lulus, R1 ${r0.results.length} lulus`,
    [...failed(d0), ...failed(r0)].join("; "));

  // Apply the six migrations, then again (idempotent).
  applyAll();
  const after = Object.fromEntries(Object.values(FN).map((fn) => [fn, md5(fn)]));
  applyAll();
  const again = Object.fromEntries(Object.values(FN).map((fn) => [fn, md5(fn)]));
  report(JSON.stringify(after) === JSON.stringify(again), "enam migrasi idempoten (dijalankan dua kali, badan sama)");
  report(after[FN.legacy] === M0_MD5, `M0: badan RPC lama = md5 dipin dalam M3 (${M0_MD5})`, after[FN.legacy]);
  report(after[FN.cb] === PINNED[FN.cb] && after[FN.crm] === PINNED[FN.crm], "callback dan CRM tidak berubah (md5)");
  report(acl(FN.legacy) === aclLegacyBefore, "M0: hak EXECUTE RPC lama tidak berubah", acl(FN.legacy));
  report(allBodies() === othersBefore, "tiada fungsi public/app lain berubah (md5 + ACL), kecuali RPC lama dan objek baharu");
  const props = psql(`select string_agg(p.proname || ':' || p.proowner::regrole || ':' || p.prosecdef || ':' || coalesce(array_to_string(p.proconfig, ','), '-'), ';' order by p.proname)
    from pg_proc p where p.oid in ('${FN.staff}'::regprocedure, '${FN.claim}'::regprocedure, '${FN.decide}'::regprocedure, '${FN.legacy}'::regprocedure);`).trim();
  report(props === "decide_public_registration_additional_funds:postgres:true:search_path=pg_catalog, public, app;"
    + "record_public_registration_additional_funds_claim:postgres:true:search_path=pg_catalog, public, app;"
    + "verify_public_registration_bank_transfer_by_staff:postgres:true:search_path=pg_catalog, public, app, extensions;"
    + "verify_public_registration_manual_payment:postgres:true:search_path=pg_catalog, public, app, extensions",
    "pemilik postgres, SECURITY DEFINER dan search_path tepat (3 RPC baharu + RPC lama)", props);
  report([FN.staff, FN.claim, FN.decide].every((fn) => acl(fn) === "{postgres=X/postgres,authenticated=X/postgres}"), "ACL tepat {postgres, authenticated} untuk 3 RPC baharu");

  // Regression: earlier contracts on top of DB-G1, with exactly the named intentional changes.
  const c1 = runChecks(section(pkg1cSql, "-- @@checks"));
  report(c1.results.length === c0.results.length && same(failed(c1), failed(c0)), `regresi PKG-1c: ${c1.results.length} semakan, sama seperti sebelum DB-G1`, failed(c1).join("; "));
  const d1 = runChecks(pkg1dChecks);
  report(d1.results.length === d0.results.length && same(failed(d1), PKG1D_CHANGED), `regresi PKG-1d-A: hanya T13 (R2 ditutup oleh M0) berubah; ${d1.results.length - failed(d1).length} lain lulus`, failed(d1).join("; "));
  const r1 = runChecks(R1_CHECKS);
  report(r1.results.length === r0.results.length && same(failed(r1), R1_CHANGED), `regresi R1: hanya "dua rekod wang berasingan" (R2) berubah; ${r1.results.length - failed(r1).length} lain lulus`, failed(r1).join("; "));

  // DB-G1 checks (the synthetic DB-G1 staff and accounts are loaded only now, after the earlier contracts ran).
  psql(section(dbg1Sql, "-- @@helpers", "-- @@checks"));
  const run = runChecks(dbg1Checks);
  for (const r of run.results) report(r.ok, r.name, r.detail);
  report(run.results.length >= 120, `bilangan semakan S (${run.results.length})`);

  // Real concurrency (committed fixtures).
  const c13 = await s13();
  console.log(`      bukti S13: ${JSON.stringify(c13)}`);
  report(s13ok(c13), "S13a dua staf serentak, pendaftaran sama: satu confirmed, satu menunggu kunci pendaftaran lalu additional_funds_review; 1 rekod bank, 1 kerusi", JSON.stringify(c13.a));
  report(c13.b.a === "confirmed|-" && c13.b.b === "already_recorded|-" && Number(c13.b.bMs) >= 2500 && c13.b.bank === 1, "S13b UUID sama serentak: already_recorded, 1 rekod bank", JSON.stringify(c13.b));
  report(c13.c.a === "confirmed|-" && String(c13.c.b).startsWith("ERR:23505") && Number(c13.c.bMs) >= 2500 && c13.c.bank1 === 1 && c13.c.bank2 === 0,
    "S13c UUID sama, pendaftaran berbeza, serentak: indeks unik menolak yang kedua (23505), rollback penuh", JSON.stringify(c13.c));
  report(["confirmed|-", "paid_unallocated|-"].every((o) => [c13.d.a, c13.d.b].includes(o)) && c13.d.taken === 1 && c13.d.enrolled === 1 && c13.d.paid === 2
    && String(c13.d.waitOn).includes("course_schedules") && !/deadlock/i.test(`${c13.d.a}${c13.d.b}`),
    "S13d kerusi terakhir serentak: satu confirmed, satu paid_unallocated, kerusi = kapasiti, menunggu kunci jadual, tiada kebuntuan", JSON.stringify(c13.d));
  const c14 = await s14();
  console.log(`      bukti S14: ${JSON.stringify(c14)}`);
  report(c14.a.staff === "confirmed|-" && c14.a.cb === "reconciliation_required" && Number(c14.a.cbMs) >= 2500 && String(c14.a.rel).includes("public_registrations")
    && c14.a.paid === 2 && c14.a.bank === 1 && c14.a.enrolled === 1 && c14.a.late === "true",
    "S14a staf dahulu, callback serentak: callback menunggu, kemudian late success; 2 rekod wang, 1 kerusi", JSON.stringify(c14.a));
  report(c14.b.cb === "confirmed" && c14.b.staff === "additional_funds_review|registration_already_paid" && Number(c14.b.staffMs) >= 2500
    && c14.b.paid === 1 && c14.b.bank === 0 && c14.b.enrolled === 1,
    "S14b callback dahulu, staf serentak: staf menunggu, kemudian additional_funds_review tanpa tulisan", JSON.stringify(c14.b));
  report(c14.c.staff === "reconciliation_required|schedule_not_finalizable" && Number(c14.c.staffMs) >= 2500 && c14.c.blockedByCancellation === true
    && c14.c.bank === "paid/cancelled" && c14.c.enrolled === 0,
    "S14c pembatalan jadual serentak: staf disekat (pg_blocking_pids) oleh transaksi yang memegang kunci tulis course_schedules, kemudian R1; bayaran kekal", JSON.stringify(c14.c));
  const c19 = await s19();
  console.log(`      bukti S19: ${JSON.stringify(c19)}`);
  report(c19.a.a === "claimed" && c19.a.b === "already_recorded" && Number(c19.a.bMs) >= 2500 && c19.a.rows === 1 && c19.a.events === 1,
    "S19a dua tuntutan serentak UUID sama: satu baris, satu acara, yang kedua already_recorded", JSON.stringify(c19.a));
  report(c19.b.a === "decided" && String(c19.b.b).startsWith("ERR:P0001:invalid_additional_funds_transition") && c19.b.status === "verified"
    && c19.b.verified === 1 && c19.b.rejected === 0,
    "S19b dua keputusan serentak: satu decided, satu ditolak (muktamad), satu acara", JSON.stringify(c19.b));

  // Mutations.
  let caught = 0;
  for (const m of MUTATIONS) {
    let applied = false;
    try {
      if (m.sql) { psql(m.sql); applied = true; }
      else if (m.key && m.find && m.repl !== undefined) {
        const mutated = SRC[m.key].replace(m.find, m.repl);
        if (mutated === SRC[m.key]) { report(false, `${m.id} ${m.name}: teks sasaran tidak ditemui`); continue; }
        psql(mutated); applied = true;
      }
    } catch (error) { report(false, `${m.id} ${m.name}: mutasi tidak dapat digunakan`, (error as Error).message.split("\n")[0]); }
    if (!applied) continue;
    let detected = false;
    let detail = "";
    if (m.detect === "race") {
      const r = await s13();
      detected = !s13ok(r);
      detail = JSON.stringify(r.a);
    } else {
      const res = runChecks(dbg1Checks);
      detected = failed(res).length > 0;
      detail = failed(res).slice(0, 2).join("; ");
    }
    if (detected) caught += 1;
    report(detected, `${m.id} ${m.name}: ditolak oleh ujian`, detail);
    if (detected) console.log(`      dikesan oleh: ${detail.slice(0, 160)}`);
    if (m.restore) psql(m.restore === "__M2__" ? SRC.m2 : m.restore);
    if (m.key) psql(SRC[m.key]);
  }
  report(caught === MUTATIONS.length, `${caught}/${MUTATIONS.length} mutasi ditolak`);
  const restored = Object.fromEntries(Object.values(FN).map((fn) => [fn, md5(fn)]));
  report(JSON.stringify(restored) === JSON.stringify(after), "selepas mutasi: semua badan dipulihkan tepat");
  const runAfterMut = runChecks(dbg1Checks);
  report(runAfterMut.results.length === run.results.length && failed(runAfterMut).length === 0, "selepas mutasi: semua semakan S lulus semula", failed(runAfterMut).join("; "));

  // Forward rollback: kill switch (revoke) on the three new RPCs + the exact pre-M0 legacy body; then re-apply.
  psql(`revoke execute on function ${FN.staff} from authenticated; revoke execute on function ${FN.claim} from authenticated;
    revoke execute on function ${FN.decide} from authenticated;\n${ROLLBACK_LEGACY}`);
  report(md5(FN.legacy) === PINNED[FN.legacy] && acl(FN.legacy) === aclLegacyBefore, "rollback: badan RPC lama A5 dipulihkan tepat (md5 b13e9b7f, ACL sama)", md5(FN.legacy));
  report([FN.staff, FN.claim, FN.decide].every((fn) => !psql(`select has_function_privilege('authenticated', '${fn}', 'EXECUTE');`).trim().startsWith("t")),
    "rollback: kill switch, 3 RPC baharu tidak boleh dilaksanakan oleh authenticated");
  report(count("select count(*) from public.public_registration_additional_funds;") >= 2 && count("select count(*) from public.payment_receiving_accounts;") === 3,
    "rollback: data kewangan sedia ada kekal (tiada DROP)");
  const rolled = runChecks(pkg1dChecks);
  report(failed(rolled).length === 0, "rollback: semakan PKG-1d-A kembali seperti sebelum DB-G1 (T13 lama lulus semula)", failed(rolled).join("; "));
  applyAll();
  const reapplied = Object.fromEntries(Object.values(FN).map((fn) => [fn, md5(fn)]));
  report(JSON.stringify(reapplied) === JSON.stringify(after) && [FN.staff, FN.claim, FN.decide].every((fn) => acl(fn) === "{postgres=X/postgres,authenticated=X/postgres}"),
    "guna semula selepas rollback: badan dan ACL sama seperti penggunaan pertama");
  const finalRun = runChecks(dbg1Checks);
  report(finalRun.results.length === run.results.length && failed(finalRun).length === 0, "guna semula: semua semakan S lulus", failed(finalRun).join("; "));
} finally {
  try { docker(["rm", "-f", "-v", container]); } catch { /* container may not exist */ }
}

console.log(failures ? `\n${failures} semakan GAGAL` : "\nSemua semakan kontrak DB PKG-1d-B-DB-G1 lulus");
process.exit(failures ? 1 : 0);
