#!/usr/bin/env node
// TERAS Staff User Management Phase 1 — STAGING validation matrix.
//
// Applies ONLY to the staging project pzgtyskhyhuxhzvyzzhe. Production is
// never touched (the CLI is always invoked with an explicit --project-ref).
//
// Seeds clearly-labelled staging test users, then exercises the Phase 1
// authorization matrix as those users (JWT-claims emulation through the
// Management API query endpoint, which runs as postgres).
//
// Usage: node scripts/database/staff-rbac-staging-check.mjs

import { spawnSync } from "node:child_process";

const REF = "pzgtyskhyhuxhzvyzzhe";
const SUPER = "00000000-0000-0000-0000-0000000000a1";
const ADMIN = "00000000-0000-0000-0000-0000000000a2";
const ADMIN2 = "00000000-0000-0000-0000-0000000000a6";
const EDITOR = "00000000-0000-0000-0000-0000000000a3";
const NO_SALES = "00000000-0000-0000-0000-0000000000a4";
const WITH_SALES = "00000000-0000-0000-0000-0000000000a5";

let passed = 0;
let failures = 0;

function cli(sql) {
  const cmd = process.platform === "win32" ? "npx.cmd" : "npx";
  const r = spawnSync(
    cmd,
    ["supabase", "db", "query", "--linked", "--project-ref", REF, "--output-format", "json"],
    { input: sql, encoding: "utf8", shell: process.platform === "win32", maxBuffer: 16 * 1024 * 1024 }
  );
  return { code: r.status ?? -1, stdout: r.stdout || "", stderr: r.stderr || "" };
}

function asUser(userId, sql) {
  return cli(
    `set request.jwt.claims = '{"sub":"${userId}","role":"authenticated"}'; ` +
      `set request.jwt.claim.sub = '${userId}'; ` +
      `set role authenticated; ${sql}`
  );
}

function val(out) {
  try {
    const arr = JSON.parse(out.stdout.trim());
    const first = arr?.[0];
    if (first && typeof first === "object") {
      const keys = Object.keys(first);
      return first[keys[0]];
    }
    return arr;
  } catch {
    return out.stdout.trim();
  }
}

function expect(name, got, want) {
  const g = String(got).trim();
  const w = String(want).trim();
  const norm = g === "t" ? "true" : g === "f" ? "false" : g;
  if (norm === w) { passed++; console.log(`  PASS ${name}`); }
  else { failures++; console.error(`  FAIL ${name}: got ${g}, want ${w}`); }
}

function expectError(name, out, needle) {
  const combined = (out.stderr || "") + (out.stdout || "");
  if (out.code !== 0 && combined.includes(needle)) { passed++; console.log(`  PASS ${name}`); }
  else { failures++; console.error(`  FAIL ${name}: expected error "${needle}", got code=${out.code} ${combined.slice(0, 200)}`); }
}

function main() {
  console.log(`== Staff RBAC Phase 1 staging validation (project ${REF}) ==`);

  // Seed clearly-labelled staging test users.
  const seed = `
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
      ('${SUPER}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','staging.super@teras.test','',now(),'{"provider":"email","providers":["email"]}','{"full_name":"Staging Super"}',now(),now()),
      ('${ADMIN}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','staging.admin@teras.test','',now(),'{"provider":"email","providers":["email"]}','{"full_name":"Staging Admin"}',now(),now()),
      ('${ADMIN2}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','staging.admin2@teras.test','',now(),'{"provider":"email","providers":["email"]}','{"full_name":"Staging Admin 2"}',now(),now()),
      ('${EDITOR}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','staging.editor@teras.test','',now(),'{"provider":"email","providers":["email"]}','{"full_name":"Staging Editor"}',now(),now()),
      ('${NO_SALES}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','staging.nosales@teras.test','',now(),'{"provider":"email","providers":["email"]}','{"full_name":"Staging NoSales"}',now(),now()),
      ('${WITH_SALES}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','staging.sales@teras.test','',now(),'{"provider":"email","providers":["email"]}','{"full_name":"Staging Sales"}',now(),now())
    on conflict (id) do nothing;
    insert into public.profiles (id, email, full_name, role, is_active) values
      ('${SUPER}','staging.super@teras.test','Staging Super','super_admin',true),
      ('${ADMIN}','staging.admin@teras.test','Staging Admin','admin',true),
      ('${ADMIN2}','staging.admin2@teras.test','Staging Admin 2','admin',true),
      ('${EDITOR}','staging.editor@teras.test','Staging Editor','editor',true),
      ('${NO_SALES}','staging.nosales@teras.test','Staging NoSales','editor',true),
      ('${WITH_SALES}','staging.sales@teras.test','Staging Sales','editor',true)
    on conflict (id) do update set role = excluded.role, is_active = excluded.is_active, full_name = excluded.full_name, email = excluded.email;
    delete from public.staff_module_access where user_id in ('${NO_SALES}','${WITH_SALES}');
    update public.profiles set access_control_enabled = true where id in ('${NO_SALES}','${WITH_SALES}');
    insert into public.staff_module_access (user_id, module_key, access_level) values
      ('${WITH_SALES}','sales_leads','view')
    on conflict (user_id, module_key) do update set access_level = excluded.access_level;
  `;
  const s = cli(seed);
  if (s.code !== 0) { console.error("SEED FAILED:\n" + s.stderr.slice(0, 1200)); process.exit(1); }

  console.log("-- Module access --");
  expect("1. Super Admin can view staff list (users module)", val(asUser(SUPER, "select public.has_module_access('users');")), true);
  expect("2. Admin can manage permitted staff (role fallback)", val(asUser(ADMIN, "select public.has_module_access('users');")), true);
  expect("3a. Legacy editor cannot manage staff", val(asUser(EDITOR, "select public.has_module_access('users');")), false);
  expect("4. Inactive check (no-sales restricted, no grant)", val(asUser(NO_SALES, "select public.has_module_access('sales_leads');")), false);
  expect("5. Sales-view user can view leads", val(asUser(WITH_SALES, "select public.has_module_access_level('sales_leads','view');")), true);
  expect("6. Sales-view user NOT granted edit", val(asUser(WITH_SALES, "select public.has_module_access_level('sales_leads','edit');")), false);

  console.log("-- RPC authorization matrix --");
  expectError("7. Editor cannot execute update_staff_profile",
    asUser(EDITOR, `select public.update_staff_profile('${NO_SALES}', p_full_name => 'Hacked');`), "forbidden");
  const okAdmin = asUser(ADMIN, `select public.update_staff_profile('${EDITOR}', p_department => 'hr');`);
  if (okAdmin.code === 0) { passed++; console.log("  PASS 8a. Admin can update a permitted staff profile"); } else { failures++; console.error("  FAIL 8a: " + okAdmin.stderr.slice(0, 160)); }
  expectError("8b. Admin cannot modify another admin", asUser(ADMIN, `select public.update_staff_profile('${ADMIN2}', p_role => 'editor');`), "forbidden_admin_target");
  expectError("8c. Admin cannot promote to super_admin", asUser(ADMIN, `select public.update_staff_profile('${EDITOR}', p_role => 'super_admin');`), "forbidden_promotion");
  expectError("8d. Admin cannot modify own profile", asUser(ADMIN, `select public.update_staff_profile('${ADMIN}', p_is_active => false);`), "cannot_modify_self");
  expectError("10. Cannot deactivate the last active super admin",
    asUser(SUPER, `select public.update_staff_profile('${SUPER}', p_is_active => false);`), "cannot remove the last active super admin");

  console.log("-- Audit trail --");
  const roleChange = asUser(ADMIN, `select public.update_staff_profile('${EDITOR}', p_role => 'trainer');`);
  if (roleChange.code === 0) { passed++; console.log("  PASS 11a. Role change executes"); } else { failures++; console.error("  FAIL 11a: " + roleChange.stderr.slice(0, 160)); }
  const roleAudit = val(cli(`select count(*) from public.audit_logs where action = 'staff_role_changed' and entity_id = '${EDITOR}';`));
  expect("11b. staff_role_changed audit row recorded", Number(roleAudit) > 0, true);
  const modChange = asUser(SUPER, `select public.set_staff_module_access('${NO_SALES}', '[{"module_key":"sales_leads","access_level":"view"}]'::jsonb);`);
  if (modChange.code === 0) { passed++; console.log("  PASS 11c. Module access update executes"); } else { failures++; console.error("  FAIL 11c: " + modChange.stderr.slice(0, 160)); }
  const modAudit = val(cli(`select count(*) from public.audit_logs where action = 'staff_module_access_changed' and entity_id = '${NO_SALES}';`));
  expect("11d. staff_module_access_changed audit row recorded", Number(modAudit) > 0, true);

  console.log(`\nResult: ${passed} passed, ${failures} failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
