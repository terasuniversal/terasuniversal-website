import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const actions = read("app/admin/(protected)/certificates/actions.ts");
const migrationPath = "supabase/migrations/20260924160000_certificate_lifecycle_force_rls_hardening.sql";

assert.ok(existsSync(new URL(`../${migrationPath}`, import.meta.url)), "I3A migration must be additive after frozen I2 migrations");
assert.doesNotMatch(actions, /return\s+error\.message\s*;/, "database messages must never be returned to a Server Action caller");
assert.match(actions, /return\s+"error"\s*;/, "unexpected issuance failures must use the stable safe code");
assert.match(actions, /Certificate issuance RPC failed[\s\S]{0,240}code:/, "issuance failures need server-only diagnostic logging");
assert.match(actions, /code === "23505"[\s\S]{0,100}return "exists"/, "expected duplicate validation remains business-facing");
assert.match(actions, /includes\("Not eligible"\)[\s\S]{0,100}return "not-eligible"/, "expected eligibility validation remains business-facing");

const migration = read(migrationPath);
assert.match(migration, /certificate_branches_lifecycle_rpc_read/);
assert.match(migration, /certificate_issuance_snapshots_lifecycle_rpc_insert/);
assert.match(migration, /certificate_reissue_events_lifecycle_rpc_insert/);
assert.doesNotMatch(migration, /DISABLE ROW LEVEL SECURITY|NO FORCE ROW LEVEL SECURITY|BYPASSRLS|GRANT\s+INSERT\s+ON\s+TABLE\s+public\.certificate_(issuance_snapshots|reissue_events)\s+TO\s+(anon|authenticated)/i);
assert.doesNotMatch(migration, /CREATE\s+OR\s+REPLACE\s+FUNCTION|ALTER\s+FUNCTION/i, "I3A policy migration must not replace or elevate lifecycle RPCs");

console.log("I3A source safety contract passed.");
console.log("- stable user-safe issuance error and server diagnostic: PASS");
console.log("- additive FORCE RLS policy migration only: PASS");
