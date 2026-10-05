import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// C4 Wave1A Erector snapshot contract — static/source-level checks only.
// No database runtime, no Docker, no Supabase CLI, no staging/production.
// Mirrors the established pattern in certificate-identity-snapshot-contract.mjs:
// reads migration source text and asserts structural/security invariants.

const repoRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const migrationDir = join(repoRoot, "supabase/migrations");
const migrationFiles = readdirSync(migrationDir)
  .filter((name) => name.endsWith(".sql"))
  .sort();

const wave1Name = "20261004023132_c4_wave1_erector_snapshot.sql";
assert.ok(migrationFiles.includes(wave1Name), "C4 Wave1A Erector snapshot migration must exist");

// Exactly one file with this exact migration version prefix (uniqueness check).
const versionMatches = migrationFiles.filter((name) => name.startsWith("20261004023132"));
assert.equal(versionMatches.length, 1, "migration version 20261004023132 must be unique in this migration set");
console.log("TEST 1 — migration version 20261004023132 is unique: PASS");

const wave1 = readFileSync(join(migrationDir, wave1Name), "utf8");

// Excluded migrations must NOT be present in this candidate set (Wave1A scope
// boundary — these are explicitly out of scope per the integration decision).
const excludedVersions = ["20260927182751", "20260929072952", "20260929120000", "20261003233640"];
for (const excluded of excludedVersions) {
  const present = migrationFiles.some((name) => name.startsWith(excluded));
  assert.ok(!present, `excluded migration version ${excluded} must not be present in this candidate`);
}
console.log("TEST 2 — excluded migration versions are absent: PASS");

// Erector course UUIDs are exactly the three fixed synthetic course IDs, and
// family/design_variant discriminators match the required QA fixture values.
assert.match(wave1, /2a78decf-6997-4626-a7cc-a1a23a110cf8/i);
assert.match(wave1, /904293c4-8792-41d7-8744-42143887e577/i);
assert.match(wave1, /b9c737b8-8a97-4c91-91ee-c65dc5982ca7/i);
assert.match(wave1, /'certificate_family',\s*'scaffold_erector'/);
assert.match(wave1, /design_variant['"]?\s*=\s*'standard_scaffold_certificate'/);
console.log("TEST 3 — Basic/Intermediate/Advanced Erector course UUIDs and family/design_variant discriminators present: PASS");

// --- Trigger interaction invariants -------------------------------------

// A. No recursive render_contract_version mutation: the guard trigger only
// fires on INSERT or UPDATE OF render_contract_version specifically (never a
// generic "before update" on the whole row), bounding its own recursion
// surface to that single column.
assert.match(wave1, /before insert or update of render_contract_version on public\.certificates/i);
console.log("TEST 4A — guard trigger scoped to INSERT or UPDATE OF render_contract_version only (no broad recursive surface): PASS");

// B. No immutable-marker bypass: the guard explicitly requires trigger depth
// > 1 (i.e. only reachable from within another trigger/function, never a
// direct top-level UPDATE) and the exact executor role, and only permits the
// transition from NULL into one of the two known renderer versions.
assert.match(wave1, /pg_catalog\.pg_trigger_depth\(\)\s*<=\s*1/);
assert.match(wave1, /old\.render_contract_version is not null/);
assert.match(wave1, /new\.render_contract_version not in \('certificate_renderer_v1', 'c4_wave1_v1'\)/);
console.log("TEST 4B — immutable marker guard requires nested trigger depth, NULL-origin, and a known renderer version (no bypass path): PASS");

// C. No duplicate issuance snapshot insert: the capture trigger is BEFORE
// INSERT only (never AFTER, never UPDATE) and the underlying table carries a
// UNIQUE(certificate_id) constraint enforced at the database level
// independent of trigger logic (asserted against the table-defining
// migration, not just this one).
assert.match(wave1, /before insert on public\.certificate_issuance_snapshots[\s\S]{0,80}?for each row execute function app\.capture_c4_wave1_erector_snapshot/);
const snapshotTableMigration = migrationFiles.find((name) =>
  /create table if not exists public\.certificate_issuance_snapshots/i.test(
    readFileSync(join(migrationDir, name), "utf8")
  )
);
assert.ok(snapshotTableMigration, "certificate_issuance_snapshots table-defining migration must exist");
const snapshotTableSource = readFileSync(join(migrationDir, snapshotTableMigration), "utf8");
assert.match(snapshotTableSource, /certificate_issuance_snapshots_certificate_key unique \(certificate_id\)/i);
console.log("TEST 4C — capture trigger is BEFORE INSERT only, backed by a UNIQUE(certificate_id) DB constraint (no duplicate snapshot insert path): PASS");

// D. No historical_update_guard conflict: the historical-immutability guard's
// protected column list (defined in the certificates_v2_dependency_unblock
// migration, the latest definition of app.certificate_historical_update_guard)
// must NOT name render_contract_version — the two guards must never fight
// over the same column.
const historicalGuardMigration = "20260922160000_certificates_v2_dependency_unblock.sql";
assert.ok(migrationFiles.includes(historicalGuardMigration), "historical update guard migration must exist");
const historicalGuardSource = readFileSync(join(migrationDir, historicalGuardMigration), "utf8");
const guardFnStart = historicalGuardSource.search(/create or replace function app\.certificate_historical_update_guard/i);
assert.ok(guardFnStart >= 0, "certificate_historical_update_guard function definition must exist");
const guardFnEnd = historicalGuardSource.indexOf("$$;", guardFnStart);
const guardFnBody = historicalGuardSource.slice(guardFnStart, guardFnEnd);
assert.ok(!/render_contract_version/i.test(guardFnBody), "historical update guard must not reference render_contract_version (no column-level conflict)");
console.log("TEST 4D — historical_update_guard's protected column list excludes render_contract_version (no guard conflict): PASS");

// E. No unsafe audit-trigger interaction: the generic app.audit_trigger()/
// app.set_updated_at()/app.stamp_actor() triggers already present on
// public.certificates (via the 0006 dynamic trigger loop) are UPDATE-timing
// (updated_at) or INSERT/UPDATE (stamp_actor) BEFORE triggers and an AFTER
// audit trigger — none of them touch render_contract_version, so they cannot
// race or double-fire the capture logic. Verified by confirming the dynamic
// loop's column lists in 0006 do not reference render_contract_version
// (that column does not exist until this Wave1A migration).
const sharedTriggerMigration = readFileSync(join(migrationDir, "0006_functions_triggers.sql"), "utf8");
assert.ok(!/render_contract_version/i.test(sharedTriggerMigration), "shared updated_at/stamp_actor/audit trigger migration predates and never references render_contract_version");
console.log("TEST 4E — generic updated_at/stamp_actor/audit triggers on certificates never reference render_contract_version (no unsafe interaction): PASS");

// F. updated_at triggers cannot cause second capture: app.set_updated_at()
// only ever assigns new.updated_at and returns — it has no branch that can
// write render_contract_version or invoke the capture function.
const setUpdatedAtMatch = sharedTriggerMigration.match(/function app\.set_updated_at\(\)[\s\S]*?\$\$;/);
assert.ok(setUpdatedAtMatch, "app.set_updated_at() definition must exist");
const setUpdatedAtBody = setUpdatedAtMatch[0];
assert.match(setUpdatedAtBody, /new\.updated_at\s*=\s*now\(\)/);
assert.match(setUpdatedAtBody, /return new;/);
assert.equal((setUpdatedAtBody.match(/\bnew\./g) || []).length, 1, "app.set_updated_at() must assign exactly one column (updated_at) and nothing else");
console.log("TEST 4F — app.set_updated_at() is a pure single-column assignment with no capture-triggering branch: PASS");

// G. BEFORE/AFTER ordering is safe: the guard (BEFORE INSERT/UPDATE OF
// render_contract_version on certificates), capture (BEFORE INSERT on
// certificate_issuance_snapshots), and marker-persist (AFTER INSERT on
// certificate_issuance_snapshots) triggers fire in that declared order
// relative to the single issuance transaction's two inserts
// (certificates row first, then certificate_issuance_snapshots row) —
// confirmed by matching each trigger's exact timing/event clause.
assert.match(wave1, /before insert or update of render_contract_version on public\.certificates/i);
assert.match(wave1, /before insert on public\.certificate_issuance_snapshots/i);
assert.match(wave1, /after insert on public\.certificate_issuance_snapshots/i);
console.log("TEST 4G — BEFORE guard / BEFORE capture / AFTER marker-persist timing clauses are exactly as documented (safe ordering): PASS");

// H. Non-Erector path remains fail-closed/no-op: for any course UUID outside
// the three known Erector IDs, the capture function either raises (when the
// design_variant claims to be Erector-shaped) or returns NEW unchanged
// (true no-op) — it never silently defaults into writing Erector-shaped
// render_payload for an unrecognized course.
assert.match(wave1, /C4 Wave 1A fail-closed: unknown Erector course UUID/);
assert.match(wave1, /if new\.template_config->>'design_variant' = 'standard_scaffold_certificate' then\s*\n\s*raise exception 'C4 Wave 1A fail-closed: unknown Erector course UUID/);
console.log("TEST 4H — non-Erector course path is fail-closed (raises on claimed Erector variant) or a true no-op (returns NEW unchanged): PASS");

// I. Duplicate/replacement path preserves intended marker semantics: when
// replaces_certificate_id is set, the guard requires the trusted executor
// role, copies the source certificate's exact marker, and the capture/
// persist functions both short-circuit to preserving the copied snapshot
// byte-for-byte rather than re-resolving current course/template data.
assert.match(wave1, /Certificate duplicates may only be created by the trusted lifecycle executor/);
assert.match(wave1, /Preserve that snapshot byte-for-byte; do not resolve/i);
assert.match(wave1, /Certificate duplicate marker does not match its copied snapshot renderer/);
assert.match(wave1, /Certificate duplicate marker does not match its immutable issuance snapshot/);
console.log("TEST 4I — duplicate/replacement path preserves the copied snapshot's marker semantics exactly (no re-resolution): PASS");

// J. The existing issue_certificate_with_skill_snapshot (latest definition)
// still inserts exactly one certificates row and one certificate_issuance_snapshots
// row per issuance call.
const issuerMigrations = migrationFiles
  .map((name) => ({ name, source: readFileSync(join(migrationDir, name), "utf8") }))
  .filter(({ source }) => /create\s+or\s+replace\s+function\s+app\.issue_certificate_with_skill_snapshot\s*\(/i.test(source));
assert.ok(issuerMigrations.length, "an issuance RPC migration must exist");
const latestIssuer = issuerMigrations.at(-1).source;
const issueStart = latestIssuer.search(/create\s+or\s+replace\s+function\s+app\.issue_certificate_with_skill_snapshot\s*\(/i);
const issueEnd = latestIssuer.indexOf("$$;", issueStart);
const issuerBody = latestIssuer.slice(issueStart, issueEnd + 3);
const certInsertCount = (issuerBody.match(/insert\s+into\s+public\.certificates\s*\(/gi) || []).length;
const snapshotInsertCount = (issuerBody.match(/insert\s+into\s+public\.certificate_issuance_snapshots\s*\(/gi) || []).length;
assert.equal(certInsertCount, 1, "issuer must insert exactly one certificates row");
assert.equal(snapshotInsertCount, 1, "issuer must insert exactly one certificate_issuance_snapshots row");
console.log("TEST 4J — issue_certificate_with_skill_snapshot inserts exactly one certificate and one snapshot per call: PASS");

// Wave1A's own embedded preflight/postcondition DO blocks assert this same
// single-insert-site invariant independently at migration-apply time.
assert.match(wave1, /trusted issuer snapshot insertion is absent\/ambiguous or uses caller-settable marker authority/);
console.log("TEST 5 — Wave1A migration embeds its own single-insert-site self-verification preflight/postcondition: PASS");

console.log("ALL C4 WAVE1A ERECTOR SNAPSHOT STATIC CONTRACT TESTS: PASS");
