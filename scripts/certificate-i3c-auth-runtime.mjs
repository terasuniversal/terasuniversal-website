import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const containerName = process.env.I3C_POSTGRES_CONTAINER ?? "teras-i3b-baseline-local";
const grantsPath = resolve(repoRoot, "supabase/tests/fixtures/certificate_i3c_auth_compat.sql");
const authorizationPath = resolve(repoRoot, "supabase/tests/certificate_i3c_authorization_runtime.sql");
const lifecyclePath = resolve(repoRoot, "scripts/certificate-i3a-lifecycle-runtime.mjs");
const fixtureUser = "a3000000-0000-4000-8000-000000000001";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed (exit ${result.status}): ${(result.stderr || "").trim()}`);
  }
  return `${result.stdout}\n${result.stderr}`;
}

const image = run("docker", ["inspect", "--format", "{{.Config.Image}}", containerName]).trim();
assert.match(image, /^postgres:17(?:\.|$)/, "I3C must use the explicitly named disposable PostgreSQL 17 container");

run("docker", [
  "exec", "-i", containerName,
  "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "i3_bootstrap", "-d", "postgres",
], { input: readFileSync(grantsPath, "utf8") });
console.log("I3C disposable-only grants: USAGE auth + EXECUTE auth.uid()/auth.jwt() for Supabase API roles; no product-object grants.");

const probe = `
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '${fixtureUser}';
SET LOCAL request.jwt.claim.role = 'authenticated';
SET LOCAL request.jwt.claims = '{"sub":"${fixtureUser}","role":"authenticated","aud":"authenticated"}';
DO $probe$
BEGIN
  IF current_user <> 'authenticated' THEN RAISE EXCEPTION 'wrong SQL role'; END IF;
  IF auth.uid() <> '${fixtureUser}'::uuid THEN RAISE EXCEPTION 'auth.uid() did not reflect synthetic request.jwt.claim.sub'; END IF;
  IF auth.jwt() <> '{"sub":"${fixtureUser}","role":"authenticated","aud":"authenticated"}'::jsonb THEN RAISE EXCEPTION 'auth.jwt() did not reflect request.jwt.claims'; END IF;
  IF NOT has_schema_privilege(current_user, 'auth', 'USAGE')
    OR NOT has_function_privilege(current_user, 'auth.uid()', 'EXECUTE')
    OR NOT has_function_privilege(current_user, 'auth.jwt()', 'EXECUTE') THEN
    RAISE EXCEPTION 'minimum Auth helper grants are missing';
  END IF;
END;
$probe$;
ROLLBACK;
`;
run("docker", [
  "exec", "-i", containerName,
  "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "i3_bootstrap", "-d", "postgres",
], { input: probe });
console.log("I3C auth.uid()/auth.jwt() synthetic JWT semantics: PASS (transaction rolled back).");

const authorizationResult = run("docker", [
  "exec", "-i", containerName,
  "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "i3_bootstrap", "-d", "postgres",
], { input: readFileSync(authorizationPath, "utf8") });
assert.equal((authorizationResult.match(/NOTICE:/g) ?? []).length, 28, "seven wrappers must be denied in each of four authorization contexts");
console.log(authorizationResult.trim());
console.log("I3C anon/no-module/inactive-admin/non-admin authorization matrix: PASS (transaction rolled back).");

run(process.execPath, [lifecyclePath], {
  env: { ...process.env, I3A_POSTGRES_CONTAINER: containerName },
  stdio: "inherit",
});
console.log("I3C auth-compatible public lifecycle runtime and issuance/render/PDF/QR verification: PASS.");
