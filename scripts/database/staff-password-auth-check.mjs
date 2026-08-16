#!/usr/bin/env node
// TERAS First-Login Password Change — local auth integration check.
//
// Requires the FULL local Supabase stack (`supabase start`) with Baseline V1
// bootstrap + post-baseline migrations applied. Validates the GoTrue password
// update behaviours that the DB-only staff-rbac-check cannot: wrong current
// password rejected, valid change succeeds, old temp password stops working,
// new password works, and the must_change_password flag is cleared only after
// success.
//
// Env: SUPABASE_LOCAL_URL, SUPABASE_LOCAL_ANON_KEY, SUPABASE_LOCAL_SERVICE_KEY
//      SUPABASE_DB_CONTAINER (default supabase_db_teras-staff-check)

import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_LOCAL_URL || "http://127.0.0.1:54721";
const ANON = process.env.SUPABASE_LOCAL_ANON_KEY;
const SERVICE = process.env.SUPABASE_LOCAL_SERVICE_KEY;
const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_teras-staff-check";
const EMAIL = `pwchange.${Date.now()}@teras.local`;
const TEMP = "TempPass123!";
const NEWPASS = "NewPass456!";

let passed = 0;
let failures = 0;

function expect(name, ok, detail = "") {
  if (ok) { passed++; console.log(`  PASS ${name}`); }
  else { failures++; console.error(`  FAIL ${name} ${detail}`); }
}

function psql(sql) {
  const r = spawnSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: sql, encoding: "utf8" });
  return { code: r.status ?? -1, stdout: r.stdout || "", stderr: r.stderr || "" };
}

function main() {
  if (!ANON || !SERVICE) {
    console.error("Set SUPABASE_LOCAL_ANON_KEY / SUPABASE_LOCAL_SERVICE_KEY (from `supabase status`).");
    process.exit(2);
  }
  const service = createClient(URL, SERVICE, { auth: { persistSession: false } });
  const user = createClient(URL, ANON, { auth: { persistSession: false } });

  const cleanup = async () => {
    // Best-effort; unique per-run emails mean leftovers are harmless on the
    // throwaway local stack.
    try {
      const { data, error } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (error) return;
      const u = (data?.users || []).find((x) => x.email === EMAIL);
      if (u) await service.auth.admin.deleteUser(u.id);
    } catch { /* ignore */ }
  };

  main2(service, user, cleanup);
}

async function main2(service, user, cleanup) {
  await cleanup();
  console.log("== First-login password change — local auth integration ==");

  // 1. Create a temporary user (as Add Staff does) -> handle_new_user profile.
  const { data: created, error: createError } = await service.auth.admin.createUser({ email: EMAIL, password: TEMP, email_confirm: true, user_metadata: { full_name: "PW Change Test" } });
  if (createError) { console.error("setup createUser failed:", createError.message); process.exit(1); }
  const uid = created?.user?.id;
  expect("A1. Temporary user created", Boolean(uid), createError?.message);
  if (!uid) process.exit(1);
  const flag = psql(`update public.profiles set must_change_password = true where id = '${uid}';`);
  expect("A2. must_change_password set to true (Add Staff onboarding)", flag.code === 0);

  // 2. Login with the temporary password.
  const loginTemp = await user.auth.signInWithPassword({ email: EMAIL, password: TEMP });
  expect("A3. Temporary password login succeeds", !loginTemp.error, loginTemp.error?.message);

  // 3. Re-auth (current-password verification) with the WRONG password -> rejected.
  const wrongReauth = await user.auth.signInWithPassword({ email: EMAIL, password: "DefinitelyWrong!" });
  expect("A4. Wrong current password rejected", Boolean(wrongReauth.error), wrongReauth.error?.message);

  // 4. Re-auth with the correct temporary password -> accepted, then updateUser.
  const okReauth = await user.auth.signInWithPassword({ email: EMAIL, password: TEMP });
  expect("A5a. Current password verification succeeds", !okReauth.error, okReauth.error?.message);
  const okChange = await user.auth.updateUser({ password: NEWPASS });
  expect("A5b. Valid password change succeeds", !okChange.error, okChange.error?.message);

  // 5. Flag still set (not cleared by the update itself).
  const flagAfter = psql(`select must_change_password from public.profiles where id = '${uid}';`);
  expect("A6. Flag still true before explicit clear", /^t$/.test(flagAfter.stdout.trim()), flagAfter.stdout);

  // 6. Clear the flag via the self-only RPC (as the user).
  const clear = await user.rpc("clear_password_change_flag");
  expect("A7. Self-only clear RPC succeeds", !clear.error, clear.error?.message);
  const flagCleared = psql(`select must_change_password from public.profiles where id = '${uid}';`);
  expect("A8. Flag cleared after success", /^f$/.test(flagCleared.stdout.trim()), flagCleared.stdout);

  // 7. Old temporary password no longer works.
  await user.auth.signOut();
  const oldLogin = await user.auth.signInWithPassword({ email: EMAIL, password: TEMP });
  expect("A9. Old temporary password rejected", Boolean(oldLogin.error), oldLogin.error?.message);

  // 8. New password works.
  const newLogin = await user.auth.signInWithPassword({ email: EMAIL, password: NEWPASS });
  expect("A10. New password works", !newLogin.error, newLogin.error?.message);

  // 9. Audit row recorded with safe metadata (no password values).
  const audit = psql(`select count(*) from public.audit_logs where action = 'password_changed' and entity_id = '${uid}';`);
  expect("A11. password_changed audit row recorded", /^[1-9]/.test(audit.stdout.trim()), audit.stdout);
  const leak = psql(`select count(*) from public.audit_logs where action = 'password_changed' and entity_id = '${uid}' and (metadata::text ~* 'password|secret|temporary' and metadata::text !~* 'password_changed')`);
  expect("A12. No password values in audit", /^0$/.test(leak.stdout.trim()), leak.stdout);

  await cleanup();
  console.log(`\nResult: ${passed} passed, ${failures} failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
