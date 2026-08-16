#!/usr/bin/env node
// TERAS Staff RBAC Phase 1 — STAGING UI-scenario mirror (DB-level).
//
// Mirrors the manual UI checklist (deactivate -> denied -> reactivate ->
// grant sales view -> view ok / edit denied -> upgrade to edit -> edit ok ->
// remove access -> denied) at the database/RPC level on staging only.
// Also verifies the pre-existing legacy staging editor keeps fallback access.
//
// Usage: node scripts/database/staff-rbac-staging-scenario.mjs

import { spawnSync } from "node:child_process";

const REF = "pzgtyskhyhuxhzvyzzhe";
const SUPER = "00000000-0000-0000-0000-0000000000a1";
const TARGET = "00000000-0000-0000-0000-0000000000a4"; // no-sales test account

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
  const norm = g === "t" ? "true" : g === "f" ? "false" : g;
  if (norm === String(want).trim()) { passed++; console.log(`  PASS ${name}`); }
  else { failures++; console.error(`  FAIL ${name}: got ${g}, want ${want}`); }
}

function ok(name, out) {
  if (out.code === 0) { passed++; console.log(`  PASS ${name}`); }
  else { failures++; console.error(`  FAIL ${name}: ${(out.stderr || out.stdout).slice(0, 200)}`); }
}

function main() {
  console.log(`== Staff RBAC Phase 1 staging UI-scenario mirror (${REF}) ==`);

  // Deactivate the non-super-admin test account.
  ok("1. Deactivate test account (super -> update_staff_profile is_active=false)",
    asUser(SUPER, `select public.update_staff_profile('${TARGET}', p_is_active => false);`));
  expect("2. Deactivated account is denied access",
    val(asUser(TARGET, "select public.has_module_access('dashboard');")), false);
  ok("3. Reactivate test account",
    asUser(SUPER, `select public.update_staff_profile('${TARGET}', p_is_active => true);`));

  // Enable explicit access control + grant Sales view only; this also proves
  // the reactivated account is functional (it can now use its granted module).
  ok("4. Enable explicit access control + grant Sales view only",
    asUser(SUPER, `select public.set_staff_module_access('${TARGET}', '[{"module_key":"sales_leads","access_level":"view"}]'::jsonb);`));
  expect("4b. Reactivated account has access to its granted module (Sales view)",
    val(asUser(TARGET, "select public.has_module_access_level('sales_leads','view');")), true);
  expect("5. Sales edit denied (view < edit)",
    val(asUser(TARGET, "select public.has_module_access_level('sales_leads','edit');")), false);

  // Upgrade to edit.
  ok("6. Upgrade Sales to edit",
    asUser(SUPER, `select public.set_staff_module_access('${TARGET}', '[{"module_key":"sales_leads","access_level":"edit"}]'::jsonb);`));
  expect("7. Sales edit allowed after upgrade",
    val(asUser(TARGET, "select public.has_module_access_level('sales_leads','edit');")), true);

  // Remove Sales access.
  ok("8. Remove Sales access",
    asUser(SUPER, `select public.set_staff_module_access('${TARGET}', '[]'::jsonb);`));
  expect("9. Sales access denied after removal",
    val(asUser(TARGET, "select public.has_module_access_level('sales_leads','view');")), false);

  // Audit trail for the lifecycle events.
  const deact = val(cli(`select count(*) from public.audit_logs where action = 'staff_deactivated' and entity_id = '${TARGET}';`));
  expect("10. staff_deactivated audit row", Number(deact) > 0, true);
  const react = val(cli(`select count(*) from public.audit_logs where action = 'staff_activated' and entity_id = '${TARGET}';`));
  expect("11. staff_activated audit row", Number(react) > 0, true);
  const modAudit = val(cli(`select count(*) from public.audit_logs where action = 'staff_module_access_changed' and entity_id = '${TARGET}';`));
  expect("12. staff_module_access_changed audit rows", Number(modAudit) >= 3, true);

  // Legacy fallback for the PRE-EXISTING staging editor profile.
  const legacyId = val(cli("select id from public.profiles where email = 'editor@teras.test' or email = 'staging.editor@teras.test' and role = 'editor' limit 1;"));
  if (legacyId && String(legacyId).length === 36) {
    expect("15. Legacy editor keeps Dashboard access (fallback)",
      val(asUser(String(legacyId), "select public.has_module_access('dashboard');")), true);
    expect("16. Legacy editor keeps Sales Leads access (fallback)",
      val(asUser(String(legacyId), "select public.has_module_access('sales_leads');")), true);
    expect("17. Legacy editor cannot manage staff (users module)",
      val(asUser(String(legacyId), "select public.has_module_access('users');")), false);
  } else {
    // The pre-existing editor may have a different email; fall back to any editor profile.
    const anyEditor = val(cli("select id from public.profiles where role = 'editor' order by created_at asc limit 1;"));
    if (anyEditor && String(anyEditor).length === 36) {
      expect("15. Existing editor keeps Dashboard access (fallback)",
        val(asUser(String(anyEditor), "select public.has_module_access('dashboard');")), true);
      expect("16. Existing editor keeps Sales Leads access (fallback)",
        val(asUser(String(anyEditor), "select public.has_module_access('sales_leads');")), true);
      expect("17. Existing editor cannot manage staff (users module)",
        val(asUser(String(anyEditor), "select public.has_module_access('users');")), false);
    } else {
      failures++;
      console.error("  FAIL 15-17: no legacy editor profile found to test fallback.");
    }
  }

  console.log(`\nResult: ${passed} passed, ${failures} failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
