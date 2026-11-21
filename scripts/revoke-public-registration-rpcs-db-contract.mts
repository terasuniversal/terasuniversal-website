import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Verifies 20261122100000_revoke_public_execute_registration_rpcs.sql (PKG-1) against an isolated, disposable local
// PostgreSQL (the Supabase Postgres image) bootstrapped from Baseline V3 + 20261106090000. It never connects to Supabase,
// Staging or Production, uses synthetic fixtures only, and removes its container on exit.
// It also proves the prepared forward-repair rollback (ROLLBACK_SQL) restores the previous access, and that re-applying
// the migration closes it again.
const root = new URL("..", import.meta.url);
const image = "public.ecr.aws/supabase/postgres:17.6.1.166";
const container = `teras-pkg1-registration-db-${process.pid}`;
const predecessor = "supabase/migrations/20261106090000_public_registration_positive_fee_only.sql";
const migration = "supabase/migrations/20261122100000_revoke_public_execute_registration_rpcs.sql";

// Prepared rollback (forward repair). Restores the exact pre-PKG-1 ACL captured on Staging and Production on
// 21 Nov 2026 (anon + authenticated + service_role, no PUBLIC). Only for a proven legitimate caller.
export const ROLLBACK_SQL = `grant execute on function public.create_public_registration(uuid, text, text, jsonb) to anon, authenticated;
grant execute on function public.begin_public_registration_payment(text, text, text) to anon, authenticated;
`;

if (process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || process.env.SUPABASE_URL) {
  throw new Error("Refusing database test: external database environment variables are set");
}

const docker = (args: string[], input?: string): string => execFileSync("docker", args, {
  cwd: root,
  input,
  encoding: "utf8",
  stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  env: { ...process.env, MSYS_NO_PATHCONV: "1" },
});

const psql = (sql: string): string => {
  try {
    return docker(["exec", "-i", container, "psql", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-qAt", "-U", "supabase_admin", "-h", "127.0.0.1", "-d", "postgres"], sql);
  } catch (error) {
    const details = error as { stdout?: string; stderr?: string };
    throw new Error(`${details.stdout ?? ""}${details.stderr ?? ""}`);
  }
};
// Runs a statement expected to fail; returns the error text (with SQLSTATE in verbose mode) or "" if it succeeded.
const psqlError = (sql: string): string => {
  try { psql(`\\set VERBOSITY verbose\n${sql}`); return ""; } catch (error) { return (error as Error).message; }
};

const bodies = `select proname || '=' || md5(regexp_replace(pg_get_functiondef(p.oid), '\\s+', '', 'g'))
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('create_public_registration', 'begin_public_registration_payment',
    'get_public_registration_schedule', 'get_public_registration_status')
  order by 1;`;
const anonCanExecute = `select has_function_privilege('anon', 'public.create_public_registration(uuid,text,text,jsonb)', 'execute')
  and has_function_privilege('anon', 'public.begin_public_registration_payment(text,text,text)', 'execute')
  and has_function_privilege('authenticated', 'public.create_public_registration(uuid,text,text,jsonb)', 'execute')
  and has_function_privilege('authenticated', 'public.begin_public_registration_payment(text,text,text)', 'execute');`;
// The schedule id is resolved as the admin first and passed as a literal: anon cannot read course_schedules (RLS), so a
// subquery run as anon would yield NULL and the function would answer P0001 invalid_registration_input instead.
let scheduleId = "";
const anonCreate = (key: string) => `set role anon;
select (public.create_public_registration('${scheduleId}'::uuid,
  '${key}', md5('${key}') || md5('${key}x'), '[{"full_name":"SYNTHETIC PKG1 Rollback Attendee"}]'::jsonb))->>'status';`;

let failures = 0;
const report = (ok: boolean, name: string, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "LULUS" : "GAGAL"} ${name}${detail && !ok ? ` -> ${detail}` : ""}`);
};

try {
  try {
    docker(["image", "inspect", image]);
  } catch {
    console.log(`TIDAK DAPAT DIUJI: imej ${image} tiada secara setempat (tiada muat turun dibuat).`);
    process.exit(2);
  }

  docker(["run", "-d", "--name", container, "-e", "POSTGRES_PASSWORD=pkg1_disposable_only", image]);
  for (let attempt = 0; ; attempt += 1) {
    try { docker(["exec", container, "pg_isready", "-U", "postgres", "-h", "127.0.0.1"]); break; }
    catch { if (attempt > 60) throw new Error("Disposable PostgreSQL did not become ready"); await new Promise((r) => setTimeout(r, 1000)); }
  }

  psql(readFileSync(new URL("supabase/baseline/v3/bootstrap.sql", root), "utf8"));
  psql(readFileSync(new URL(predecessor, root), "utf8"));
  report(psql(anonCanExecute).trim() === "t", "sebelum PKG-1: anon dan authenticated boleh EXECUTE kedua-dua RPC (keadaan Production semasa)");
  const before = psql(bodies).trim();

  const migrationSql = readFileSync(new URL(migration, root), "utf8");
  psql(migrationSql);
  psql(migrationSql); // forward-only and idempotent: a second run must succeed and change nothing
  report(psql(bodies).trim() === before, "migrasi tidak mengubah badan mana-mana fungsi pendaftaran (grant sahaja)");
  report(psql(anonCanExecute).trim() === "f", "selepas PKG-1: anon/authenticated tiada EXECUTE");

  const out = psql(readFileSync(new URL("scripts/revoke-public-registration-rpcs-db-contract.sql", root), "utf8"));
  for (const line of out.split("\n")) {
    const m = /^RESULT\|(PASS|FAIL)\|([^|]*)\|(.*)$/.exec(line.trim());
    if (m) report(m[1] === "PASS", m[2], m[3]);
  }
  const passed = out.split("\n").filter((l) => l.startsWith("RESULT|PASS|")).length;
  if (passed < 17) report(false, "bilangan semakan SQL kurang daripada jangkaan", String(passed));

  scheduleId = psql(`select cs.id from public.course_schedules cs join public.courses c on c.id = cs.course_id
    where c.slug = 'synthetic-pkg1-course';`).trim();
  report(/^[0-9a-f-]{36}$/.test(scheduleId), "fixture: ID jadual sintetik diperoleh sebagai admin", scheduleId);

  // A direct anon call with a valid input on an eligible schedule is a permission error (42501), never P0001.
  const denied = psqlError(anonCreate("pkg1-direct-anon-key-01"));
  report(/42501/.test(denied) && /permission denied for function create_public_registration/.test(denied),
    "anon terus: 42501 permission denied (bukan ralat validasi)", denied.split("\n")[0]);

  // Rollback readiness: the prepared forward repair restores the previous access...
  psql(ROLLBACK_SQL);
  report(psql(anonCanExecute).trim() === "t", "rollback: grant dipulihkan kepada anon/authenticated");
  report(psql(anonCreate("pkg1-rollback-anon-key1")).trim().split("\n").pop() === "created", "rollback: anon boleh mencipta semula (akses lama dipulihkan sepenuhnya)");
  // ...and re-applying PKG-1 closes it again.
  psql(migrationSql);
  report(psql(anonCanExecute).trim() === "f", "guna semula PKG-1 selepas rollback: akses ditutup semula");
  report(/42501/.test(psqlError(anonCreate("pkg1-reapply-anon-key1"))), "guna semula PKG-1: anon sekali lagi 42501");
} finally {
  try { docker(["rm", "-f", container]); } catch { /* container may not exist */ }
}

console.log(failures ? `\n${failures} semakan GAGAL` : "\nSemua semakan kontrak DB PKG-1 lulus");
process.exit(failures ? 1 : 0);
