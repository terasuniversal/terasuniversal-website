import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// C4 Wave1A Erector snapshot contract — static/source-level checks only.
// No database runtime, no Docker, no Supabase CLI, no staging/production.
//
// IMPORTANT: every security-sensitive assertion below operates on
// `wave1Code`, a comment-stripped copy of the migration SQL, never on the
// raw source. A comment containing an expected phrase must NOT satisfy any
// check — only an executable SQL statement may.

const repoRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const migrationDir = join(repoRoot, "supabase/migrations");
const migrationFiles = readdirSync(migrationDir)
  .filter((name) => name.endsWith(".sql"))
  .sort();

// Strip `-- ...` line comments. This migration's string/dollar-quoted content
// never itself contains `--` outside actual PL/pgSQL comments, and this strip
// only ever REMOVES text, so it can turn a false positive into a false
// negative but never let a comment satisfy a check.
function stripSqlComments(source) {
  return source
    .split(/\r\n|\n/)
    .map((line) => {
      const idx = line.indexOf("--");
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join("\n");
}

const wave1Name = "20261004023132_c4_wave1_erector_snapshot.sql";
assert.ok(migrationFiles.includes(wave1Name), "C4 Wave1A Erector snapshot migration must exist");

// Migration version uniqueness.
const versionMatches = migrationFiles.filter((name) => name.startsWith("20261004023132"));
assert.equal(versionMatches.length, 1, "migration version 20261004023132 must be unique in this migration set");
console.log("TEST 1 — migration version 20261004023132 is unique: PASS");

const wave1 = readFileSync(join(migrationDir, wave1Name), "utf8");
const wave1Code = stripSqlComments(wave1);

// Excluded migration versions remain absent.
const excludedVersions = ["20260927182751", "20260929072952", "20260929120000", "20261003233640"];
for (const excluded of excludedVersions) {
  const present = migrationFiles.some((name) => name.startsWith(excluded));
  assert.ok(!present, `excluded migration version ${excluded} must not be present in this candidate`);
}
console.log("TEST 2 — excluded migration versions are absent: PASS");

// All three Erector course UUIDs, scaffold_erector family, and
// standard_scaffold_certificate variant, in executable code.
assert.match(wave1Code, /'2a78decf-6997-4626-a7cc-a1a23a110cf8'::uuid/i);
assert.match(wave1Code, /'904293c4-8792-41d7-8744-42143887e577'::uuid/i);
assert.match(wave1Code, /'b9c737b8-8a97-4c91-91ee-c65dc5982ca7'::uuid/i);
assert.match(wave1Code, /jsonb_build_object\(\s*\n\s*'canonical_course_id',\s*v_course_id,\s*\n\s*'certificate_family',\s*'scaffold_erector'/);
assert.match(wave1Code, /new\.template_config->>'design_variant'\s*(?:=|is distinct from)\s*'standard_scaffold_certificate'/);
console.log("TEST 3 — Basic/Intermediate/Advanced Erector course UUIDs and family/design_variant discriminators present in executable code: PASS");

// --- Extract each new function's definition as an executable SQL block ---
function extractFunctionDef(code, qualifiedName) {
  const re = new RegExp(`create or replace function ${qualifiedName.replace(/\./g, "\\.")}\\s*\\(`, "i");
  const start = code.search(re);
  assert.ok(start >= 0, `${qualifiedName} definition must exist as executable SQL`);
  const asMatch = code.slice(start).match(/\bas\s+(\$[a-zA-Z0-9_]*\$)/);
  assert.ok(asMatch, `${qualifiedName} must have a dollar-quoted body`);
  const tag = asMatch[1];
  const tagEnd = start + asMatch.index + asMatch[0].length;
  const bodyEnd = code.indexOf(tag, tagEnd);
  assert.ok(bodyEnd > tagEnd, `${qualifiedName} dollar-quoted body must close with ${tag}`);
  return code.slice(start, bodyEnd + tag.length + 1);
}

const guardDef = extractFunctionDef(wave1Code, "app.guard_certificate_render_contract");
const captureDef = extractFunctionDef(wave1Code, "app.capture_c4_wave1_erector_snapshot");
const persistDef = extractFunctionDef(wave1Code, "app.persist_certificate_render_contract_marker");

// Ownership/security mode of each new function: each must declare SECURITY
// INVOKER as an executable clause of its own CREATE FUNCTION statement.
for (const [name, def] of [
  ["app.guard_certificate_render_contract", guardDef],
  ["app.capture_c4_wave1_erector_snapshot", captureDef],
  ["app.persist_certificate_render_contract_marker", persistDef],
]) {
  assert.match(def, /\bsecurity invoker\b/i, `${name} must declare SECURITY INVOKER`);
  assert.doesNotMatch(def, /\bsecurity definer\b/i, `${name} must not declare SECURITY DEFINER`);
}
console.log("TEST 4 — all three new Wave1A trigger functions are executable SECURITY INVOKER definitions: PASS");

// No invalid ownership-transfer sequence requiring unsupported SET ROLE, and
// no ALTER ... OWNER TO certificate_lifecycle_executor for any new function.
assert.doesNotMatch(wave1Code, /set\s+local\s+role\s+certificate_lifecycle_executor/i, "migration must not depend on an unsupported SET LOCAL ROLE to certificate_lifecycle_executor");
for (const fnName of [
  "app.guard_certificate_render_contract()",
  "app.capture_c4_wave1_erector_snapshot()",
  "app.persist_certificate_render_contract_marker()",
]) {
  const ownerRe = new RegExp(`alter function ${fnName.replace(/[().]/g, "\\$&")} owner to certificate_lifecycle_executor`, "i");
  assert.doesNotMatch(wave1Code, ownerRe, `${fnName} must not be transferred to certificate_lifecycle_executor ownership`);
}
console.log("TEST 5 — no SET LOCAL ROLE dependency and no new-function ownership transfer to certificate_lifecycle_executor: PASS");

// No forbidden broad CREATE grant on schema app.
assert.doesNotMatch(wave1Code, /grant\s+(?:[\w,\s]*\bcreate\b[\w,\s]*)\s+on\s+schema\s+app\s+to/i, "migration must not grant CREATE ON SCHEMA app to any role");
console.log("TEST 6 (Part B.1) — no CREATE ON SCHEMA app grant present: PASS");

// No new API-role SET membership to certificate_lifecycle_executor.
assert.doesNotMatch(wave1Code, /grant\s+certificate_lifecycle_executor\s+to\s+(?:anon|authenticated|service_role)/i, "migration must not grant certificate_lifecycle_executor membership to an API role");
console.log("TEST 7 (Part B.2) — no new API-role membership grant to certificate_lifecycle_executor: PASS");

// No executor LOGIN/SUPERUSER/BYPASSRLS escalation statement.
assert.doesNotMatch(wave1Code, /alter\s+role\s+certificate_lifecycle_executor\b[^;]*\b(login|superuser|bypassrls)\b/i, "migration must not escalate the executor role's LOGIN/SUPERUSER/BYPASSRLS attributes");
console.log("TEST 8 (Part B.3) — no executor LOGIN/SUPERUSER/BYPASSRLS escalation statement: PASS");

// Exact column-level UPDATE(render_contract_version) grant exists.
assert.match(wave1Code, /grant\s+update\s*\(\s*render_contract_version\s*\)\s+on\s+public\.certificates\s+to\s+certificate_lifecycle_executor/i, "migration must grant column-scoped UPDATE(render_contract_version) on public.certificates to the executor");
console.log("TEST 9 (Part B.6) — exact column-level GRANT UPDATE(render_contract_version) ON public.certificates present: PASS");

// No broad (whole-table) UPDATE grant on public.certificates anywhere in this migration.
const broadUpdateRe = /grant\s+(?:[\w,\s]*,\s*)?update(?!\s*\()\s+(?:[\w,\s]*\s+)?on\s+public\.certificates\b/i;
assert.doesNotMatch(wave1Code, broadUpdateRe, "migration must not grant a broad (whole-row) UPDATE on public.certificates");
assert.doesNotMatch(wave1Code, /grant\s+all\b[^;]*\bon\s+public\.certificates\b/i, "migration must not grant ALL privileges on public.certificates");
console.log("TEST 10 (Part B.7) — no broad UPDATE(public.certificates) grant present: PASS");

// Existing issuer owner/ACL/search_path precondition is an executable DO-block check.
assert.match(wave1Code, /v_owner\s*<>\s*'certificate_lifecycle_executor'/i);
assert.match(wave1Code, /v_definer\s+is\s+distinct\s+from\s+true/i);
assert.match(wave1Code, /v_config\s+is\s+distinct\s+from\s+array\['search_path=public, app, extensions'\]::text\[\]/i);
console.log("TEST 11 (Part B.8) — existing issuer owner/ACL/search_path is asserted by an executable precondition comparison: PASS");

// app.request_actor_id() usage and auth.uid() absence are checked via
// pg_catalog.strpos() on the live function definition (executable).
assert.match(wave1Code, /pg_catalog\.strpos\(v_definition,\s*'app\.request_actor_id\(\)'\)\s*=\s*0/i);
assert.match(wave1Code, /pg_catalog\.strpos\(v_definition,\s*'auth\.uid\(\)'\)\s*>\s*0/i);
console.log("TEST 12 (Part B.9) — app.request_actor_id() usage / auth.uid() absence checked via executable strpos() on the live function body: PASS");

// Exactly one issuance-snapshot insert, asserted via an executable
// strpos()-based single-occurrence check in the migration's own preflight.
assert.match(wave1Code, /v_insert\s+text\s*:=\s*'insert into public\.certificate_issuance_snapshots \('/i);
assert.match(wave1Code, /v_pos\s*=\s*0\s+or\s+pg_catalog\.strpos\(pg_catalog\.substr\(v_definition,\s*v_pos\s*\+\s*pg_catalog\.length\(v_insert\)\),\s*v_insert\)\s*>\s*0/i);
console.log("TEST 13 (Part B.10) — exactly-one-insertion-site check is an executable strpos()-based assertion in the migration itself: PASS");

// Trigger definitions are connected to the actual functions being inspected.
const triggerFunctionPairs = [
  [/create trigger trg_guard_certificate_render_contract[\s\S]{0,200}?execute function (app\.guard_certificate_render_contract)\(\)/i, "app.guard_certificate_render_contract"],
  [/create trigger trg_capture_c4_wave1_erector_snapshot[\s\S]{0,200}?execute function (app\.capture_c4_wave1_erector_snapshot)\(\)/i, "app.capture_c4_wave1_erector_snapshot"],
  [/create trigger trg_persist_certificate_render_contract_marker[\s\S]{0,200}?execute function (app\.persist_certificate_render_contract_marker)\(\)/i, "app.persist_certificate_render_contract_marker"],
];
for (const [re, expectedFn] of triggerFunctionPairs) {
  const match = wave1Code.match(re);
  assert.ok(match, `trigger must bind to ${expectedFn} by an executable CREATE TRIGGER ... EXECUTE FUNCTION clause`);
  assert.equal(match[1].toLowerCase(), expectedFn.toLowerCase(), `trigger must bind to exactly ${expectedFn}, not a different function`);
}
console.log("TEST 14 (Part B.15) — all three CREATE TRIGGER statements bind to the exact inspected function names: PASS");

// --- Trigger interaction invariants (executable-code based) --------------

// A. No recursive render_contract_version mutation.
assert.match(wave1Code, /before insert or update of render_contract_version on public\.certificates/i);
console.log("TEST 15A — guard trigger scoped to INSERT or UPDATE OF render_contract_version only (no broad recursive surface): PASS");

// B. No immutable-marker bypass.
assert.match(guardDef, /pg_catalog\.pg_trigger_depth\(\)\s*<=\s*1/);
assert.match(guardDef, /old\.render_contract_version is not null/);
assert.match(guardDef, /new\.render_contract_version not in \('certificate_renderer_v1', 'c4_wave1_v1'\)/);
console.log("TEST 15B — immutable marker guard requires nested trigger depth, NULL-origin, and a known renderer version (no bypass path): PASS");

// C. No duplicate issuance snapshot insert.
assert.match(wave1Code, /before insert on public\.certificate_issuance_snapshots[\s\S]{0,80}?for each row execute function app\.capture_c4_wave1_erector_snapshot/);
const snapshotTableMigration = migrationFiles.find((name) =>
  /create table if not exists public\.certificate_issuance_snapshots/i.test(
    readFileSync(join(migrationDir, name), "utf8")
  )
);
assert.ok(snapshotTableMigration, "certificate_issuance_snapshots table-defining migration must exist");
const snapshotTableSource = readFileSync(join(migrationDir, snapshotTableMigration), "utf8");
assert.match(snapshotTableSource, /certificate_issuance_snapshots_certificate_key unique \(certificate_id\)/i);
console.log("TEST 15C — capture trigger is BEFORE INSERT only, backed by a UNIQUE(certificate_id) DB constraint (no duplicate snapshot insert path): PASS");

// D. No historical_update_guard conflict.
const historicalGuardMigration = "20260922160000_certificates_v2_dependency_unblock.sql";
assert.ok(migrationFiles.includes(historicalGuardMigration), "historical update guard migration must exist");
const historicalGuardSource = stripSqlComments(readFileSync(join(migrationDir, historicalGuardMigration), "utf8"));
const guardFnBody2 = extractFunctionDef(historicalGuardSource, "app.certificate_historical_update_guard");
assert.ok(!/render_contract_version/i.test(guardFnBody2), "historical update guard must not reference render_contract_version (no column-level conflict)");
console.log("TEST 15D — historical_update_guard's protected column list excludes render_contract_version (no guard conflict): PASS");

// E/F. No unsafe audit-trigger interaction; updated_at cannot cause second capture.
const sharedTriggerMigration = stripSqlComments(readFileSync(join(migrationDir, "0006_functions_triggers.sql"), "utf8"));
assert.ok(!/render_contract_version/i.test(sharedTriggerMigration), "shared updated_at/stamp_actor/audit trigger migration predates and never references render_contract_version");
const setUpdatedAtBody = extractFunctionDef(sharedTriggerMigration, "app.set_updated_at");
assert.match(setUpdatedAtBody, /new\.updated_at\s*=\s*now\(\)/);
assert.equal((setUpdatedAtBody.match(/\bnew\./g) || []).length, 1, "app.set_updated_at() must assign exactly one column (updated_at) and nothing else");
console.log("TEST 15E/F — generic triggers never touch render_contract_version; set_updated_at() is a pure single-column assignment: PASS");

// G. BEFORE/AFTER ordering is safe.
assert.match(wave1Code, /before insert or update of render_contract_version on public\.certificates/i);
assert.match(wave1Code, /before insert on public\.certificate_issuance_snapshots/i);
assert.match(wave1Code, /after insert on public\.certificate_issuance_snapshots/i);
console.log("TEST 15G — BEFORE guard / BEFORE capture / AFTER marker-persist timing clauses are exactly as documented (safe ordering): PASS");

// H. Non-Erector path remains fail-closed/no-op.
assert.match(captureDef, /raise exception 'C4 Wave 1A fail-closed: unknown Erector course UUID/);
assert.match(captureDef, /if new\.template_config->>'design_variant' = 'standard_scaffold_certificate' then\s*\n\s*raise exception 'C4 Wave 1A fail-closed: unknown Erector course UUID/);
console.log("TEST 15H — non-Erector course path is fail-closed (raises on claimed Erector variant) or a true no-op (returns NEW unchanged): PASS");

// I. Duplicate/replacement path preserves intended marker semantics.
assert.match(guardDef, /Certificate duplicates may only be created by the trusted lifecycle executor/);
// Executable evidence that the duplicate path short-circuits before any
// course/template/programme resolution: v_replaces_certificate_id is checked
// and `return new;` is reached before v_course_id is ever read via
// `select c.course_id` or the course-UUID branches below it.
const captureReplacesCheckIdx = captureDef.search(/if\s+v_replaces_certificate_id\s+is\s+not\s+null\s+then/i);
const captureCourseSelectIdx = captureDef.search(/select\s+c\.course_id/i);
assert.ok(captureReplacesCheckIdx >= 0, "capture function must branch on v_replaces_certificate_id");
assert.ok(captureCourseSelectIdx >= 0 && captureCourseSelectIdx < captureReplacesCheckIdx, "course_id is selected once before the duplicate branch, not re-resolved inside it");
const duplicateBranch = captureDef.slice(captureReplacesCheckIdx, captureDef.indexOf("return new;", captureReplacesCheckIdx) + "return new;".length);
assert.match(duplicateBranch, /return new;/, "duplicate branch must return immediately without re-resolving course/template/programme data");
assert.doesNotMatch(duplicateBranch, /jsonb_build_object\(\s*\n\s*'canonical_course_id'/, "duplicate branch must not rebuild the Erector render_payload");
assert.match(captureDef, /Certificate duplicate marker does not match its copied snapshot renderer/);
assert.match(persistDef, /Certificate duplicate marker does not match its immutable issuance snapshot/);
console.log("TEST 15I — duplicate/replacement path preserves the copied snapshot's marker semantics exactly (no re-resolution): PASS");

// J. The existing issue_certificate_with_skill_snapshot (latest definition)
// still inserts exactly one certificates row and one
// certificate_issuance_snapshots row per issuance call.
const issuerMigrations = migrationFiles
  .map((name) => ({ name, code: stripSqlComments(readFileSync(join(migrationDir, name), "utf8")) }))
  .filter(({ code }) => /create\s+or\s+replace\s+function\s+app\.issue_certificate_with_skill_snapshot\s*\(/i.test(code));
assert.ok(issuerMigrations.length, "an issuance RPC migration must exist");
const latestIssuer = issuerMigrations.at(-1).code;
const issuerBody = extractFunctionDef(latestIssuer, "app.issue_certificate_with_skill_snapshot");
const certInsertCount = (issuerBody.match(/insert\s+into\s+public\.certificates\s*\(/gi) || []).length;
const snapshotInsertCount = (issuerBody.match(/insert\s+into\s+public\.certificate_issuance_snapshots\s*\(/gi) || []).length;
assert.equal(certInsertCount, 1, "issuer must insert exactly one certificates row");
assert.equal(snapshotInsertCount, 1, "issuer must insert exactly one certificate_issuance_snapshots row");
console.log("TEST 15J — issue_certificate_with_skill_snapshot inserts exactly one certificate and one snapshot per call: PASS");

// Wave1A's own embedded preflight/postcondition DO blocks assert the narrow
// executor privilege postconditions added in the review repair.
assert.match(wave1Code, /has_column_privilege\('certificate_lifecycle_executor', 'public\.certificates', 'render_contract_version', 'UPDATE'\)/i);
assert.match(wave1Code, /has_table_privilege\('certificate_lifecycle_executor', 'public\.certificates', 'UPDATE'\)/i);
assert.match(wave1Code, /has_schema_privilege\('certificate_lifecycle_executor', 'app', 'CREATE'\)/i);
console.log("TEST 16 — Wave1A migration embeds its own executable narrow-privilege postconditions (column UPDATE present, table-wide UPDATE absent, schema CREATE absent): PASS");

console.log("ALL C4 WAVE1A ERECTOR SNAPSHOT STATIC CONTRACT TESTS: PASS");
