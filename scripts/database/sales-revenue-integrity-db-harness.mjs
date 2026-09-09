/*
 * Disposable-DB harness for Sales Revenue Integrity Hardening.
 *
 * This is deliberately opt-in. It requires a pre-seeded isolated database,
 * never points at a project URL by default, and does not create or repair
 * fixtures. The pgTAP files cover structural/behavior assertions; the two concurrent
 * calls below exercise the acceptance lock with caller-supplied sent quotes.
 * Session A deliberately holds the Opportunity row lock while Session B is
 * started, and the harness observes B before releasing A.
 *
 * Usage (isolated DB only):
 *   $env:TERAS_RUN_ISOLATED_DB_TESTS = "1"
 *   $env:TERAS_ISOLATED_DB_URL = "postgresql://..."
 *   $env:TERAS_TEST_QUOTE_A = "..."
 *   $env:TERAS_TEST_QUOTE_B = "..."
 *   $env:TERAS_TEST_ACTOR_ID = "..."
 *   $env:TERAS_TEST_OPPORTUNITY_ID = "..."
 *   node scripts/database/sales-revenue-integrity-db-harness.mjs --preflight
 *
 * To apply the feature migration to that disposable database only, set
 * TERAS_ALLOW_ISOLATED_MIGRATION=1 and pass --migration explicitly before
 * running the tests. The harness never applies a migration by default.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const required = ["TERAS_ISOLATED_DB_URL", "TERAS_TEST_QUOTE_A", "TERAS_TEST_QUOTE_B", "TERAS_TEST_ACTOR_ID", "TERAS_TEST_OPPORTUNITY_ID"];
if (process.env.TERAS_RUN_ISOLATED_DB_TESTS !== "1") {
  console.error("Refusing to run: set TERAS_RUN_ISOLATED_DB_TESTS=1 explicitly for a disposable isolated database.");
  process.exit(2);
}
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`Missing isolated test configuration: ${missing.join(", ")}`);
  process.exit(2);
}

const dockerDbContainer = process.env.TERAS_DOCKER_DB_CONTAINER;
function psqlArgs(extraArgs) {
  if (dockerDbContainer) return ["exec", "-i", dockerDbContainer, "psql", ...extraArgs];
  return [process.env.TERAS_ISOLATED_DB_URL, ...extraArgs];
}

const migrationPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../supabase/migrations/20260908161659_sales_revenue_integrity_hardening.sql");
if (process.argv.includes("--migration")) {
  if (process.env.TERAS_ALLOW_ISOLATED_MIGRATION !== "1") {
    console.error("Refusing to apply migration: set TERAS_ALLOW_ISOLATED_MIGRATION=1 explicitly for a disposable isolated database.");
    process.exit(2);
  }
  await psqlFile(migrationPath);
  console.log("Feature migration applied to the explicitly configured isolated database only.");
}

function psql(sql) {
  return new Promise((resolve, reject) => {
    const child = spawn(dockerDbContainer ? "docker" : "psql", psqlArgs(["-v", "ON_ERROR_STOP=1", "-X", "-At", "-U", "postgres", "-d", "postgres", "-c", sql]), { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr || `psql exited ${code}`)));
  });
}

function psqlFile(filePath, includePgTapSearchPath = false) {
  return new Promise((resolve, reject) => {
    const args = ["-v", "ON_ERROR_STOP=1", "-X", "-U", "postgres", "-d", "postgres"];
    if (includePgTapSearchPath) args.push("-c", "SET search_path = public, extensions;");
    const useDocker = Boolean(dockerDbContainer);
    if (!useDocker) args.push("-f", filePath);
    const child = spawn(useDocker ? "docker" : "psql", psqlArgs(args), { stdio: [useDocker ? "pipe" : "ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    if (useDocker) child.stdin.end(readFileSync(filePath, "utf8"));
    child.on("close", (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr || `psql exited ${code}`)));
  });
}

function psqlFileWithVars(filePath, vars, includePgTapSearchPath = false) {
  return new Promise((resolve, reject) => {
    const args = dockerDbContainer
      ? ["-v", "ON_ERROR_STOP=1", "-X", "-U", "postgres", "-d", "postgres"]
      : [process.env.TERAS_ISOLATED_DB_URL, "-v", "ON_ERROR_STOP=1", "-X", "-U", "postgres", "-d", "postgres"];
    for (const [key, value] of Object.entries(vars)) args.push("-v", `${key}=${value}`);
    const useDocker = Boolean(dockerDbContainer);
    if (includePgTapSearchPath) args.push("-c", "SET search_path = public, extensions;");
    if (!useDocker) args.push("-f", filePath);
    const child = spawn(useDocker ? "docker" : "psql", psqlArgs(args), { stdio: [useDocker ? "pipe" : "ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    if (useDocker) child.stdin.end(readFileSync(filePath, "utf8"));
    child.on("close", (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr || `psql exited ${code}`)));
  });
}

function persistentPsql() {
  const child = spawn(dockerDbContainer ? "docker" : "psql", psqlArgs(["-v", "ON_ERROR_STOP=1", "-X", "-At", "-U", "postgres", "-d", "postgres"]), { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  return { child, get stdout() { return stdout; }, get stderr() { return stderr; } };
}

function waitForOutput(session, marker) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (session.stdout.includes(marker)) { clearInterval(timer); resolve(); }
      else if (session.child.exitCode !== null) { clearInterval(timer); reject(new Error(session.stderr || `psql exited ${session.child.exitCode}`)); }
      else if (Date.now() - started > 10000) { clearInterval(timer); reject(new Error(`Timed out waiting for ${marker}`)); }
    }, 25);
  });
}

function waitForExit(session) {
  return new Promise((resolve, reject) => {
    if (session.child.exitCode !== null) return resolve(session.child.exitCode);
    session.child.once("close", (code) => resolve(code));
    session.child.once("error", reject);
  });
}

const actor = process.env.TERAS_TEST_ACTOR_ID.replaceAll("'", "''");
const quoteA = process.env.TERAS_TEST_QUOTE_A.replaceAll("'", "''");
const quoteB = process.env.TERAS_TEST_QUOTE_B.replaceAll("'", "''");
const opportunity = process.env.TERAS_TEST_OPPORTUNITY_ID.replaceAll("'", "''");
const sessionA = persistentPsql();
const sessionB = persistentPsql();
let a;
let b;
async function runConcurrency() {
try {
  sessionA.child.stdin.write(`begin; select id from public.sales_opportunities where id='${opportunity}' for update; select 'OPPORTUNITY_LOCKED';\n`);
  await waitForOutput(sessionA, "OPPORTUNITY_LOCKED");

  sessionB.child.stdin.write(`begin; select set_config('request.jwt.claims', '{"sub":"${actor}"}', true); select public.accept_quotation('${quoteB}'); commit;\n`);
  await new Promise((resolve) => setTimeout(resolve, 500));
  if (sessionB.child.exitCode !== null) throw new Error("Session B completed before Session A released the Opportunity lock");

  sessionA.child.stdin.write(`select set_config('request.jwt.claims', '{"sub":"${actor}"}', true); select public.accept_quotation('${quoteA}'); commit;\n\\q\n`);
  const aCode = await waitForExit(sessionA);
  if (aCode !== 0) throw new Error(`Session A acceptance failed: ${sessionA.stderr}`);
  b = await Promise.race([
    waitForExit(sessionB).then((code) => ({ status: code === 0 ? "fulfilled" : "rejected", code, stdout: sessionB.stdout, stderr: sessionB.stderr })),
    new Promise((resolve) => setTimeout(() => resolve({ status: "timeout" }), 10000)),
  ]);
  if (b.status === "timeout") throw new Error("Session B did not resume after Session A committed");
  if (b.status !== "rejected" || !/invalid_transition|opportunity is already resolved|quotation_opportunity_changed_during_acceptance/i.test(`${b.stdout}\n${b.stderr}`)) {
    throw new Error(`Session B did not fail with the expected governed transition error: ${JSON.stringify(b)}`);
  }
  a = { status: "fulfilled" };
} finally {
  if (sessionA.child.exitCode === null) sessionA.child.kill();
  if (sessionB.child.exitCode === null) { sessionB.child.stdin.write("rollback;\\q\n"); sessionB.child.kill(); }
}

const succeeded = a.status === "fulfilled" ? 1 : 0;
const acceptedCount = await psql(`select count(*) from public.sales_quotations where id in ('${quoteA}', '${quoteB}') and status = 'accepted';`);
const duplicateCount = await psql(`select count(*) from (select opportunity_id from public.sales_quotations where opportunity_id='${opportunity}' and status='accepted' group by opportunity_id having count(*) > 1) duplicates;`);
const finalStage = await psql(`select stage from public.sales_opportunities where id='${opportunity}';`);
if (succeeded !== 1 || acceptedCount !== "1" || duplicateCount !== "0" || finalStage !== "won") {
  throw new Error(`Concurrency invariant failed: successful_sessions=${succeeded}, accepted_count=${acceptedCount}, duplicate_opportunities=${duplicateCount}, final_stage=${finalStage}`);
}
}

const testPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../supabase/tests/sales_revenue_integrity_hardening_test.sql");
await psqlFile(testPath, true);
if (process.argv.includes("--behavior")) {
  const behaviorPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../supabase/tests/sales_revenue_integrity_behavior_test.sql");
  await psqlFileWithVars(behaviorPath, { actor_id: process.env.TERAS_TEST_ACTOR_ID }, true);
}
await runConcurrency();
if (process.argv.includes("--preflight")) {
  const preflightPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../supabase/tests/sales_revenue_integrity_preflight.sql");
  console.log(await psqlFile(preflightPath));
}
console.log("Isolated acceptance concurrency and structural pgTAP harness completed: Session A succeeded, Session B was observed blocked and then rejected, and exactly one accepted quotation remained.");
