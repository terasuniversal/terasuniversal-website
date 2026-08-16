#!/usr/bin/env node
// TERAS Database Baseline V1 — fresh replay verification.
//
// Purpose: prove that "Baseline V1 bootstrap -> (post-baseline migrations)"
// reconstructs the canonical production schema on a brand-new environment.
//
// Usage:
//   1. Have Docker running.
//   2. From the repo root:  node scripts/database/verify-baseline-replay.mjs
//      (or: supabase db start --local  first if you want to reuse a stack)
//
// Behaviour (defaults to a throwaway local stack, leaves production untouched):
//   1. `supabase db reset --local`  -> empty environment.
//   2. Apply supabase/baseline/v1/bootstrap.sql via psql.
//   3. Verify the app.app_schema_baseline marker was written.
//   4. Apply any post-baseline migrations (version >= 20260817000000) in order.
//   5. Compare key object counts against supabase/baseline/v1/manifest.json.
//   6. Print PASS/FAIL.
//
// This is intentionally small and CI-agnostic. Wire it into whatever CI runs
// `npm run lint`/`npm run build` today; do not stand up a new CI platform.
// Only NEW/empty environments are tested; production is never touched.

import { spawnSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const baselineDir = join(root, "supabase", "baseline", "v1");
const bootstrapPath = join(baselineDir, "bootstrap.sql");
const manifestPath = join(baselineDir, "manifest.json");
const migrationsDir = join(root, "supabase", "migrations");
const POST_BASELINE_MIN = "20260817000000";
// Local Supabase stack under test (CI: point these at the CI provisioned stack).
const workdir = process.env.SUPABASE_PROJECT_DIR || root;
const CONTAINER =
  process.env.SUPABASE_DB_CONTAINER || `supabase_db_${basename(workdir)}`;

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", stdio: opts.silent ? "pipe" : "inherit", ...opts });
  if (r.error) throw r.error;
  return { code: r.status ?? -1, stdout: r.stdout || "", stderr: r.stderr || "" };
}

function psql(sql, opts = {}) {
  return run("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-t", "-A", ...(opts.noStop ? [] : ["-v", "ON_ERROR_STOP=1"])], {
    input: sql,
    silent: true,
  });
}

function isPostBaseline(file) {
  const m = /^(\d{14})_/.exec(file);
  return m ? m[1] >= POST_BASELINE_MIN : false;
}

function main() {
  if (!existsSync(bootstrapPath)) {
    console.error(`FAIL: bootstrap.sql not found at ${bootstrapPath}`);
    process.exit(1);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const bootstrap = readFileSync(bootstrapPath, "utf8");

  console.log("== TERAS Baseline V1 replay verification ==");
  console.log("Project under test: local throwaway Supabase stack (production untouched).\n");

  // 1. Empty environment
  console.log("[1/5] Resetting local database to empty...");
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  const reset = run(npx, ["supabase", "db", "reset", "--local"], { cwd: workdir, silent: false, shell: process.platform === "win32" });
  if (reset.code !== 0) {
    console.error("FAIL: could not reset local database (is `supabase db start`/Docker running?).");
    process.exit(1);
  }

  // 2. Apply bootstrap
  console.log("[2/5] Applying Baseline V1 bootstrap.sql...");
  const boot = psql(bootstrap);
  if (boot.code !== 0) {
    console.error("FAIL: bootstrap.sql errored:\n" + (boot.stderr || boot.stdout).slice(0, 2000));
    process.exit(1);
  }

  // 3. Marker check
  console.log("[3/5] Verifying baseline marker...");
  const marker = psql("select baseline_version from app.app_schema_baseline limit 1;");
  if (marker.code !== 0 || !/v1/.test(marker.stdout)) {
    console.error("FAIL: app.app_schema_baseline marker missing after bootstrap.");
    process.exit(1);
  }
  console.log(`     marker: ${marker.stdout.trim()}`);

  // 4. Post-baseline migrations
  const postFiles = existsSync(migrationsDir)
    ? readdirSorted(migrationsDir).filter(isPostBaseline)
    : [];
  console.log(`[4/5] Applying ${postFiles.length} post-baseline migration(s)...`);
  for (const f of postFiles) {
    const sql = readFileSync(join(migrationsDir, f), "utf8");
    const r = psql(sql);
    if (r.code !== 0) {
      console.error(`FAIL: post-baseline migration ${f} errored:\n` + (r.stderr || r.stdout).slice(0, 2000));
      process.exit(1);
    }
  }

  // 5. Count comparison vs manifest
  console.log("[5/5] Comparing object counts against manifest.json...");
  const counts = psql(
    `select
       (select count(*) from information_schema.tables where table_schema in ('public','app') and table_type='BASE TABLE' and table_name <> 'app_schema_baseline'),
       (select count(*) from information_schema.views where table_schema in ('public','app')),
       (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app') and p.prokind in ('f','p')),
       (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','app') and not t.tgisinternal),
       (select count(*) from pg_policies where schemaname in ('public','app'));`
  );
  const m = manifest.object_counts || {};
  const expect = [m.table_count, m.view_count, m.function_count, m.trigger_count, m.rls_policy_count];
  const got = counts.stdout.trim().split("|").map((x) => Number(x.trim()));
  const labels = ["tables", "views", "functions", "triggers", "policies"];
  let ok = true;
  for (let i = 0; i < labels.length; i++) {
    const match = got[i] === expect[i];
    ok = ok && match;
    console.log(`     ${labels[i]}: got ${got[i]} / expected ${expect[i]} ${match ? "OK" : "MISMATCH"}`);
  }

  if (ok) {
    console.log("\nPASS: Baseline V1 bootstrap reconstructs the canonical production schema counts.");
    process.exit(0);
  }
  console.error("\nFAIL: counts differ from the frozen production snapshot (see manifest.json).");
  process.exit(1);
}

function readdirSorted(dir) {
  return readdirSync(dir).sort();
}

main();
