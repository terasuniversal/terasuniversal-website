import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Verifies 20261106090000_public_registration_positive_fee_only.sql against an
// isolated, disposable local PostgreSQL (the Supabase Postgres image) that is
// bootstrapped from Baseline V3. It never connects to Supabase, Staging or
// Production, uses synthetic fixtures only, and removes its container on exit.
const root = new URL("..", import.meta.url);
const image = "public.ecr.aws/supabase/postgres:17.6.1.166";
const container = `teras-positive-fee-db-${process.pid}`;
const migration = "supabase/migrations/20261106090000_public_registration_positive_fee_only.sql";

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
    return docker(["exec", "-i", container, "psql", "-v", "ON_ERROR_STOP=1", "-qAt", "-U", "supabase_admin", "-h", "127.0.0.1", "-d", "postgres"], sql);
  } catch (error) {
    const details = error as { stdout?: string; stderr?: string };
    throw new Error(`${details.stdout ?? ""}${details.stderr ?? ""}`);
  }
};

const normalisedHashes = `select proname || '=' || md5(regexp_replace(regexp_replace(pg_get_functiondef(p.oid), '--[^\\n]*', '', 'g'), '\\s+', ' ', 'g'))
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('create_public_registration', 'get_public_registration_schedule', 'begin_public_registration_payment')
  order by 1;`;

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

  docker(["run", "-d", "--name", container, "-e", "POSTGRES_PASSWORD=positive_fee_disposable_only", image]);
  for (let attempt = 0; ; attempt += 1) {
    try { docker(["exec", container, "pg_isready", "-U", "postgres", "-h", "127.0.0.1"]); break; }
    catch { if (attempt > 60) throw new Error("Disposable PostgreSQL did not become ready"); await new Promise((r) => setTimeout(r, 1000)); }
  }

  psql(readFileSync(new URL("supabase/baseline/v3/bootstrap.sql", root), "utf8"));
  const before = psql(normalisedHashes).trim().split("\n");
  const get = (lines: string[], name: string) => lines.find((l) => l.startsWith(`${name}=`)) ?? "";
  report(Boolean(get(before, "create_public_registration")), "baseline V3 menyediakan fungsi pendaftaran");

  const migrationSql = readFileSync(new URL(migration, root), "utf8");
  psql(migrationSql);
  psql(migrationSql); // forward-only and idempotent: a second run must succeed
  const after = psql(normalisedHashes).trim().split("\n");
  report(get(before, "create_public_registration") !== get(after, "create_public_registration"), "migrasi mengubah create_public_registration");
  report(get(before, "get_public_registration_schedule") !== get(after, "get_public_registration_schedule"), "migrasi mengubah get_public_registration_schedule");
  report(get(before, "begin_public_registration_payment") === get(after, "begin_public_registration_payment"), "fungsi pembayaran tidak diubah");
  report(!/^\s*(drop|truncate|delete|update)\b/im.test(migrationSql.replace(/--[^\n]*/g, "")), "migrasi tiada DROP/TRUNCATE/DELETE/UPDATE");

  const out = psql(readFileSync(new URL("scripts/public-registration-positive-fee-db-contract.sql", root), "utf8"));
  for (const line of out.split("\n")) {
    const m = /^RESULT\|(PASS|FAIL)\|([^|]*)\|(.*)$/.exec(line.trim());
    if (m) report(m[1] === "PASS", m[2], m[3]);
  }
  const passed = out.split("\n").filter((l) => l.startsWith("RESULT|PASS|")).length;
  if (passed < 40) report(false, "bilangan semakan SQL kurang daripada jangkaan", String(passed));

  // The anon role (what the public site uses) can still call the RPCs.
  const anon = psql("set role anon; select registration_available::text from public.get_public_registration_schedule('00000000-0000-0000-0000-000000000000'::uuid);");
  report(anon.trim() === "", "anon masih boleh memanggil get_public_registration_schedule (tiada baris untuk ID tiada)");
} finally {
  try { docker(["rm", "-f", container]); } catch { /* container may not exist */ }
}

console.log(failures ? `\n${failures} semakan GAGAL` : "\nSemua semakan kontrak SQL lulus");
process.exit(failures ? 1 : 0);
