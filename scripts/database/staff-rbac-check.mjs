#!/usr/bin/env node
// TERAS Staff User Management Phase 1 — security check (local stack only).
//
// Runs the Phase-1 authorization matrix end-to-end against a FRESH local
// Supabase stack:
//   1. `supabase db reset --local`        -> empty environment
//   2. Baseline V1 bootstrap              -> canonical production schema
//   3. post-baseline migrations (>=20260817000000) -> Staff/RBAC Phase 1
//   4. seed test profiles + run assertions as each user
//
// Usage (from repo root, Docker running):
//   node scripts/database/staff-rbac-check.mjs
// Env overrides: SUPABASE_PROJECT_DIR, SUPABASE_DB_CONTAINER.
//
// Production is NEVER touched.

import { spawnSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const workdir = process.env.SUPABASE_PROJECT_DIR || root;
const CONTAINER = process.env.SUPABASE_DB_CONTAINER || `supabase_db_${basename(workdir)}`;
const baselineDir = join(root, "supabase", "baseline", "v1");
const migrationsDir = join(root, "supabase", "migrations");
const POST_BASELINE_MIN = "20260817000000";

const SUPER = "00000000-0000-0000-0000-000000000001";
const ADMIN = "00000000-0000-0000-0000-000000000002";
const EDITOR = "00000000-0000-0000-0000-000000000003";
const INACTIVE = "00000000-0000-0000-0000-000000000004";
const NO_SALES = "00000000-0000-0000-0000-000000000005";
const WITH_SALES = "00000000-0000-0000-0000-000000000006";
const WITH_USERS = "00000000-0000-0000-0000-000000000007";
const ADMIN2 = "00000000-0000-0000-0000-000000000008";
const TRAINER = "00000000-0000-0000-0000-000000000009";
// Direct-RPC authorization matrix (PR #25 security fix)
const ADM_EXPL_ADMIN = "00000000-0000-0000-0000-0000000000b1"; // admin, explicit, users=admin
const ADM_EXPL_EDIT = "00000000-0000-0000-0000-0000000000b2";  // admin, explicit, users=edit
const ADM_EXPL_VIEW = "00000000-0000-0000-0000-0000000000b3";  // admin, explicit, users=view
const ADM_EXPL_NONE = "00000000-0000-0000-0000-0000000000b4";  // admin, explicit, no users grant
const EDITOR_USERS_ADMIN = "00000000-0000-0000-0000-0000000000b5"; // editor, explicit, users=admin

let failures = 0;
let passed = 0;

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  if (r.error) throw r.error;
  return { code: r.status ?? -1, stdout: r.stdout || "", stderr: r.stderr || "" };
}

function psql(sql, opts = {}) {
  return run("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: sql, ...opts });
}

/** Run SQL as a specific user (sets JWT claims + authenticated role). */
function psqlAs(userId, sql) {
  const prefix =
    `set request.jwt.claims = '{"sub":"${userId}","role":"authenticated"}'; ` +
    `set request.jwt.claim.sub = '${userId}'; ` +
    `set role authenticated;`;
  return psql(prefix + "\n" + sql);
}

/** Extract the actual query result, ignoring psql SET command tags. */
function scalar(out) {
  return out.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && l !== "SET")
    .pop();
}

function expectBool(name, got, want) {
  const norm = String(got === "t" ? "true" : got === "f" ? "false" : got);
  if (norm === String(want)) { passed++; console.log(`  PASS ${name}`); }
  else { failures++; console.error(`  FAIL ${name}: got ${got}, want ${want}`); }
}

function expectError(name, out, needle) {
  if (out.code !== 0 && (out.stderr || "").includes(needle)) { passed++; console.log(`  PASS ${name}`); }
  else { failures++; console.error(`  FAIL ${name}: expected error containing "${needle}", got code=${out.code} err=${(out.stderr || "").slice(0, 200)}`); }
}

function expectOk(name, out) {
  if (out.code === 0) { passed++; console.log(`  PASS ${name}`); }
  else { failures++; console.error(`  FAIL ${name}: unexpected error: ${(out.stderr || out.stdout).slice(0, 200)}`); }
}

function main() {
  console.log("== Staff User Management / RBAC Phase 1 — security check ==");
  console.log(`Local stack under test: ${workdir} (production untouched).`);

  // 1. Fresh environment
  console.log("[1/4] Resetting local database...");
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  const reset = run(npx, ["supabase", "db", "reset", "--local"], { cwd: workdir, shell: process.platform === "win32" });
  if (reset.code !== 0) { console.error("FAIL: could not reset local database."); process.exit(1); }

  // 2. Baseline bootstrap
  console.log("[2/4] Applying Baseline V1 bootstrap...");
  const boot = psql(readFileSync(join(baselineDir, "bootstrap.sql"), "utf8"));
  if (boot.code !== 0) { console.error("FAIL: bootstrap errored.\n" + boot.stderr.slice(0, 1500)); process.exit(1); }

  // 3. Post-baseline migrations (>= 20260817000000)
  console.log("[3/4] Applying post-baseline migrations...");
  const files = existsSync(migrationsDir) ? readdirSorted(migrationsDir).filter((f) => /^\d{14}_/.test(f) && f.slice(0, 14) >= POST_BASELINE_MIN) : [];
  for (const f of files) {
    const r = psql(readFileSync(join(migrationsDir, f), "utf8"));
    if (r.code !== 0) { console.error(`FAIL: post-baseline migration ${f} errored.\n${r.stderr.slice(0, 1500)}`); process.exit(1); }
  }

  // 4. Seed test users + assertions
  console.log("[4/4] Seeding test profiles and running assertions...");
  const seed = `
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
      ('${SUPER}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','super@teras.test','',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
      ('${ADMIN}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','admin@teras.test','',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
      ('${EDITOR}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','editor@teras.test','',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
      ('${INACTIVE}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','inactive@teras.test','',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
      ('${NO_SALES}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','nosales@teras.test','',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
      ('${WITH_SALES}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','sales@teras.test','',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
('${WITH_USERS}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','users@teras.test','',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
('${ADMIN2}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','admin2@teras.test','',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
('${TRAINER}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','trainer@teras.test','',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
      ('${ADM_EXPL_ADMIN}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','adm-expl-admin@teras.test','',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
      ('${ADM_EXPL_EDIT}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','adm-expl-edit@teras.test','',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
      ('${ADM_EXPL_VIEW}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','adm-expl-view@teras.test','',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
      ('${ADM_EXPL_NONE}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','adm-expl-none@teras.test','',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
      ('${EDITOR_USERS_ADMIN}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','editor-users-admin@teras.test','',now(),'{"provider":"email","providers":["email"]}','{}',now(),now())
    on conflict (id) do nothing;
    insert into public.profiles (id, email, full_name, role, is_active) values
      ('${SUPER}','super@teras.test','Super Admin','super_admin',true),
      ('${ADMIN}','admin@teras.test','Admin User','admin',true),
      ('${EDITOR}','editor@teras.test','Editor User','editor',true),
      ('${INACTIVE}','inactive@teras.test','Inactive User','editor',false),
      ('${NO_SALES}','nosales@teras.test','No Sales','editor',true),
      ('${WITH_SALES}','sales@teras.test','With Sales','editor',true),
      ('${WITH_USERS}','users@teras.test','With Users','editor',true),
      ('${ADMIN2}','admin2@teras.test','Admin Two','admin',true),
      ('${TRAINER}','trainer@teras.test','Trainer User','trainer',true),
      ('${ADM_EXPL_ADMIN}','adm-expl-admin@teras.test','Adm Expl Admin','admin',true),
      ('${ADM_EXPL_EDIT}','adm-expl-edit@teras.test','Adm Expl Edit','admin',true),
      ('${ADM_EXPL_VIEW}','adm-expl-view@teras.test','Adm Expl View','admin',true),
      ('${ADM_EXPL_NONE}','adm-expl-none@teras.test','Adm Expl None','admin',true),
      ('${EDITOR_USERS_ADMIN}','editor-users-admin@teras.test','Editor Users Admin','editor',true)
    on conflict (id) do update set
      email = excluded.email,
      full_name = excluded.full_name,
      role = excluded.role,
      is_active = excluded.is_active;
    delete from public.staff_module_access where user_id in ('${NO_SALES}','${WITH_SALES}','${WITH_USERS}','${ADM_EXPL_ADMIN}','${ADM_EXPL_EDIT}','${ADM_EXPL_VIEW}','${ADM_EXPL_NONE}','${EDITOR_USERS_ADMIN}');
    update public.profiles set access_control_enabled = true
      where id in ('${NO_SALES}','${WITH_SALES}','${WITH_USERS}','${ADM_EXPL_ADMIN}','${ADM_EXPL_EDIT}','${ADM_EXPL_VIEW}','${ADM_EXPL_NONE}','${EDITOR_USERS_ADMIN}');
    insert into public.staff_module_access (user_id, module_key, access_level) values
      ('${WITH_SALES}','sales_leads','view'),
      ('${WITH_USERS}','users','view'),
      ('${ADM_EXPL_ADMIN}','users','admin'),
      ('${ADM_EXPL_EDIT}','users','edit'),
      ('${ADM_EXPL_VIEW}','users','view'),
      ('${EDITOR_USERS_ADMIN}','users','admin')
    on conflict (user_id, module_key) do update set access_level = excluded.access_level;
  `;
  const s = psql(seed);
  if (s.code !== 0) { console.error("FAIL: seeding errored.\n" + s.stderr.slice(0, 1500)); process.exit(1); }

  console.log("-- Module access --");
  expectBool("1. Super Admin can view staff list (users module)",
    scalar(psqlAs(SUPER, "select public.has_module_access('users');")), true);
  expectBool("2. Admin can manage permitted staff (users module via role fallback)",
    scalar(psqlAs(ADMIN, "select public.has_module_access('users');")), true);
  expectBool("3a. Editor (legacy) cannot manage staff",
    scalar(psqlAs(EDITOR, "select public.has_module_access('users');")), false);
  expectBool("3b. Editor with explicit users grant can manage staff",
    scalar(psqlAs(WITH_USERS, "select public.has_module_access('users');")), true);
  expectBool("4. Inactive staff is denied",
    scalar(psqlAs(INACTIVE, "select public.has_module_access('dashboard');")), false);
  expectBool("5. User without Sales access cannot access Sales (leads)",
    scalar(psqlAs(NO_SALES, "select public.has_module_access('sales_leads');")), false);
  expectBool("6a. User with Sales view can view leads",
    scalar(psqlAs(WITH_SALES, "select public.has_module_access_level('sales_leads','view');")), true);
  expectBool("6b. Sales-view user is not granted edit level",
    scalar(psqlAs(WITH_SALES, "select public.has_module_access_level('sales_leads','edit');")), false);

  console.log("-- Server-side RPC authorization matrix --");
  expectError("7. Editor cannot execute update_staff_profile (not admin)",
    psqlAs(EDITOR, `select public.update_staff_profile('${WITH_SALES}', p_full_name => 'Hacked');`), "forbidden");
  expectOk("8a. Admin can update a permitted (non-admin) staff profile",
    psqlAs(ADMIN, `select public.update_staff_profile('${EDITOR}', p_full_name => 'Editor Updated', p_department => 'hr');`));
  expectError("8b. Admin cannot modify another admin profile",
    psqlAs(ADMIN, `select public.update_staff_profile('${ADMIN2}', p_role => 'editor');`), "forbidden_admin_target");
  expectError("8c. Admin cannot promote someone to super_admin",
    psqlAs(ADMIN, `select public.update_staff_profile('${EDITOR}', p_role => 'super_admin');`), "forbidden_promotion");
  expectError("8d. Admin cannot modify own profile",
    psqlAs(ADMIN, `select public.update_staff_profile('${ADMIN}', p_is_active => false);`), "cannot_modify_self");

  console.log("-- Direct-RPC authorization (PR #25 security fix) --");
  expectOk("A. Legacy admin + users fallback -> allowed",
    psqlAs(ADMIN, `select public.update_staff_profile('${EDITOR}', p_department => 'hr');`));
  expectOk("B. Explicit admin + users=admin -> allowed",
    psqlAs(ADM_EXPL_ADMIN, `select public.update_staff_profile('${EDITOR}', p_department => 'hr');`));
  expectError("C. Explicit admin + users=edit -> denied (42501)",
    psqlAs(ADM_EXPL_EDIT, `select public.update_staff_profile('${EDITOR}', p_department => 'hr');`), "forbidden");
  expectError("D. Explicit admin + users=view -> denied (42501)",
    psqlAs(ADM_EXPL_VIEW, `select public.update_staff_profile('${EDITOR}', p_department => 'hr');`), "forbidden");
  expectError("E. Explicit admin + no users grant -> denied (42501)",
    psqlAs(ADM_EXPL_NONE, `select public.update_staff_profile('${EDITOR}', p_department => 'hr');`), "forbidden");
  expectError("F. Direct set_staff_module_access denied for explicit admin w/o users=admin",
    psqlAs(ADM_EXPL_VIEW, `select public.set_staff_module_access('${EDITOR}', '[]'::jsonb);`), "forbidden");
  expectOk("G. super_admin still allowed",
    psqlAs(SUPER, `select public.update_staff_profile('${EDITOR}', p_department => 'hr');`));
  expectError("H. Editor with users=admin explicit grant -> denied (role floor)",
    psqlAs(EDITOR_USERS_ADMIN, `select public.update_staff_profile('${EDITOR}', p_department => 'hr');`), "forbidden");

  console.log("-- RLS still protects --");
  // Non-granted column (is_active) is not updatable by authenticated at all
  // (column grant revoked) -> permission denied, super stays active.
  const rls = psqlAs(NO_SALES, `update public.profiles set is_active = false where id = '${SUPER}';`);
  expectBool("9a. Cross-user role/is_active update is denied",
    rls.code !== 0 ? "denied" : "allowed", "denied");
  const stillActive = scalar(psql(`select is_active from public.profiles where id = '${SUPER}';`));
  expectBool("9a. Super admin unchanged", stillActive, true);
  const esc = psqlAs(EDITOR, `update public.profiles set role = 'super_admin' where id = '${EDITOR}';`);
  expectBool("9b. Self role escalation is blocked (column grant removed)",
    esc.code !== 0 ? "blocked" : "allowed", "blocked");

  console.log("-- Last active Super Admin protection --");
  expectError("10. Cannot deactivate the last active super admin",
    psqlAs(SUPER, `select public.update_staff_profile('${SUPER}', p_is_active => false);`), "cannot remove the last active super admin");

  console.log("-- Regression: existing roles keep their access --");
  expectBool("R1. Legacy editor keeps Dashboard access",
    scalar(psqlAs(EDITOR, "select public.has_module_access('dashboard');")), true);
  expectBool("R2. Legacy editor keeps Sales Leads access (role fallback)",
    scalar(psqlAs(EDITOR, "select public.has_module_access('sales_leads');")), true);
  expectBool("R3. Legacy editor still cannot manage staff",
    scalar(psqlAs(EDITOR, "select public.has_module_access('users');")), false);
  expectBool("R4. Trainer keeps Attendance access",
    scalar(psqlAs(TRAINER, "select public.has_module_access('attendance');")), true);
  expectBool("R5. Trainer keeps Certificates access",
    scalar(psqlAs(TRAINER, "select public.has_module_access('certificates');")), true);
  const login = psqlAs(EDITOR, `update public.profiles set last_login_at = now() where id = '${EDITOR}';`);
  expectBool("R6. Login flow profile update (last_login_at) still works",
    login.code === 0 ? "ok" : "denied", "ok");
  const myAccess = scalar(psqlAs(SUPER, "select exists(select 1 from jsonb_array_elements(public.get_my_module_access()) e where e->>'module_key' = 'users')"));
  expectBool("R7. get_my_module_access() exposes users module to super admin",
    myAccess, true);
  const legacyNav = scalar(psqlAs(EDITOR, "select jsonb_array_length(public.get_my_module_access()) > 0"));
  expectBool("R8. Legacy editor gets a non-empty module set for the sidebar",
    legacyNav, true);

  console.log("-- Audit trail --");
  const audit = psqlAs(ADMIN, `select public.update_staff_profile('${EDITOR}', p_role => 'trainer');`);
  expectOk("11a. Role change executes", audit);
  const roleAudit = scalar(psql(`select count(*) from public.audit_logs where action = 'staff_role_changed' and entity_id = '${EDITOR}' and actor_id = '${ADMIN}';`));
  expectBool("11b. staff_role_changed audit row recorded", roleAudit !== "0", true);
  const modAudit = psqlAs(SUPER, `select public.set_staff_module_access('${NO_SALES}', '[{"module_key":"sales_leads","access_level":"view"}]'::jsonb);`);
  expectOk("11c. Module access update executes", modAudit);
  const modRows = scalar(psql(`select count(*) from public.audit_logs where action = 'staff_module_access_changed' and entity_id = '${NO_SALES}';`));
  expectBool("11d. staff_module_access_changed audit row recorded", modRows !== "0", true);

  console.log("\nResult: " + passed + " passed, " + failures + " failed.");
  process.exit(failures === 0 ? 0 : 1);
}

function readdirSorted(dir) {
  return readdirSync(dir).sort();
}

main();
