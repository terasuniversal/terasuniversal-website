import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const certData = read("app/admin/(protected)/certificates/certData.ts");
const actions = read("app/admin/(protected)/certificates/actions.ts");
const schemas = read("lib/validation/schemas.ts");
const api = read("app/api/admin/certificates/route.js");
const reactRenderer = read("components/admin/CertificateDocument.tsx");
const htmlRenderer = read("lib/certificate-html.ts");
const scaffoldHtml = read("lib/professional-scaffold-certificate-html.ts");
const migration = read("supabase/migrations/20260913010000_certificate_historical_immutability.sql");

assert.match(certData, /certificate_issuance_snapshots/);
assert.match(certData, /renderMode = snapshot \? "MODERN_SNAPSHOT" : "LEGACY_FALLBACK"/);
assert.match(certData, /if \(!snapshot && config\.design_variant === "standard_scaffold_certificate"\)/);
assert.match(certData, /if \(!snapshot && config\.design_variant === "working_at_height_certificate"\)/);
assert.match(certData, /verificationMetadata\.certificate_number/);
assert.match(certData, /snapshot\.template_config/);
assert.match(certData, /snapshot\?\.holder_name/);
assert.match(certData, /snapshot\?\.course_name/);
assert.match(certData, /snapshot\?\.training_start_date/);
assert.match(certData, /snapshot\?\.signature_reference/);

assert.match(actions, /rpc\("reissue_certificate"/);
assert.doesNotMatch(actions, /update\(\{ status: "valid", issue_date:/);
assert.match(actions, /p_event_type: eventType/);
assert.match(actions, /p_reason: reason \|\| null/);
assert.match(actions, /p_notes: \{\}/);
assert.match(actions, /certificateReissueSchema\.safeParse/);
assert.match(schemas, /certificateReissueSchema = z\.object/);
assert.match(schemas, /max\(500\)/);
assert.match(certData, /rendering stopped safely/);
assert.match(certData, /renderPayload\.programme_duration/);

assert.match(api, /action === "create" \|\| action === "update"/);
assert.match(api, /canonical eligibility and issuance flow/);
assert.match(api, /action === "legacy_import"/);
assert.match(api, /action === "bulk".*explicit legacy_import/s);
assert.match(api, /deleted_at/);
assert.doesNotMatch(actions, /from\("certificates"\)\.update/);
assert.doesNotMatch(api, /from\("certificates"\)\.update/);
assert.match(actions, /rpc\("revoke_certificate"/);
assert.match(actions, /rpc\("update_certificate_metadata"/);
assert.match(actions, /rpc\("set_certificate_deleted"/);
assert.match(actions, /rpc\("set_certificate_verification_enabled"/);
assert.match(actions, /rpc\("duplicate_certificate_with_skill_snapshot"/);
assert.doesNotMatch(actions, /duplicate_certificate_with_skill_snapshot[\s\S]*from\("certificates"\)\.update/);
assert.match(actions, /Verification token regeneration is not supported/);
assert.match(api, /rpc\("set_certificate_deleted"/);
assert.match(migration, /revoke all on public\.certificates from anon, authenticated/);
assert.doesNotMatch(migration, /grant update \(/);
for (const field of ["replaces_certificate_id", "certificate_file_url", "metadata", "legacy_batch_id"]) {
  assert.match(migration, new RegExp(`new\\.${field} is distinct from old\\.${field}`));
}
assert.match(migration, /create or replace function app\.duplicate_certificate_with_skill_snapshot/);
assert.match(migration, /v_actor is null or not app\.is_active\(\) or not app\.is_admin\(\)/);
assert.match(migration, /public\.has_module_access_level\('certificates', 'admin'\)/);
assert.match(migration, /set verification_url = '\/verify\/' \|\| v_token/);
assert.match(migration, /if v_has_snapshot then/);
assert.match(read("app/admin/(protected)/certificates/[id]/page.tsx"), /reissueHistoryError/);

assert.match(reactRenderer, /export interface CertData/);
assert.match(htmlRenderer, /CertData/);
assert.match(scaffoldHtml, /CertData/);

console.log("C2B/C2C application contract tests: PASS");
console.log("- snapshot-first render provenance and fields: PASS");
console.log("- explicit legacy fallback path: PASS");
console.log("- event-only reissue RPC wiring: PASS");
console.log("- modern direct API create/update rejection: PASS");
console.log("- explicit legacy import path: PASS");
console.log("- React and HTML renderers share CertData contract: PASS");
