import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const migrationPath = resolve(root, "supabase/migrations/20260924120000_certificate_c5b1_verification_control.sql");
const correctiveMigrationPath = resolve(root, "supabase/migrations/20260924130000_certificate_c5b1_import_boolean_cast_fix.sql");
const finalStateMigrationPath = resolve(root, "supabase/migrations/20260924140000_certificate_c5b1_production_final_state.sql");
const sqlTestPath = resolve(root, "supabase/tests/certificate_verification_control_contract.sql");
const wrapperSecurityTestPath = resolve(root, "supabase/tests/certificate_legacy_import_anon_invoker_contract.sql");
const migration = readFileSync(migrationPath, "utf8");
const correctiveMigration = readFileSync(correctiveMigrationPath, "utf8");
assert.ok(existsSync(finalStateMigrationPath), "missing C5B1 Production final-state migration 20260924140000");
const finalStateMigration = readFileSync(finalStateMigrationPath, "utf8");
assert.ok(existsSync(wrapperSecurityTestPath), "missing C5B1 staging anon-wrapper security contract");
const wrapperSecurityTest = readFileSync(wrapperSecurityTestPath, "utf8");
const sqlTest = readFileSync(sqlTestPath, "utf8");

const functionBodyFrom = (source, name, nextMarker) => {
  const start = source.indexOf(`create or replace function ${name}`);
  assert.notEqual(start, -1, `missing replacement for ${name}`);
  const end = source.indexOf(nextMarker, start);
  assert.notEqual(end, -1, `missing end marker for ${name}`);
  return source.slice(start, end);
};
const functionBody = (name, nextMarker) => functionBodyFrom(migration, name, nextMarker);

const verifier = functionBody(
  "public.verify_and_log(",
  "revoke all on function public.verify_and_log",
);
const legacyImport = functionBody(
  "app.import_legacy_certificate(",
  "revoke all on function app.import_legacy_certificate",
);
const verificationToggle = functionBody(
  "app.set_certificate_verification_enabled(",
  "revoke all on function app.set_certificate_verification_enabled",
);
const finalVerifier = functionBodyFrom(
  finalStateMigration,
  "public.verify_and_log(",
  "revoke all on function public.verify_and_log",
);
const finalImport = functionBodyFrom(
  finalStateMigration,
  "app.import_legacy_certificate(",
  "revoke all on function app.import_legacy_certificate",
);
const finalToggle = functionBodyFrom(
  finalStateMigration,
  "app.set_certificate_verification_enabled(",
  "revoke all on function app.set_certificate_verification_enabled",
);
const correctiveImportStart = correctiveMigration.indexOf("create or replace function app.import_legacy_certificate(");
assert.notEqual(correctiveImportStart, -1, "missing corrective import replacement");
const correctiveImportEnd = correctiveMigration.indexOf("\n$$;", correctiveImportStart);
assert.notEqual(correctiveImportEnd, -1, "missing corrective import function end");
const correctedImport = correctiveMigration.slice(correctiveImportStart, correctiveImportEnd);

assert.match(verifier, /security definer/i);
assert.match(verifier, /set search_path\s*=\s*pg_catalog/i);
assert.match(verifier, /coalesce\(v\.public_verification_enabled,\s*true\)\s+is\s+false/i);
assert.match(verifier, /v\.verification_enabled\s+is\s+false/i);
assert.match(verifier, /v\.status\s+not in\s*\('valid',\s*'issued',\s*'expired',\s*'revoked'\)/i);
assert.match(verifier, /c\.deleted_at\s+is null/i);
assert.match(verifier, /v_status,\s*\(v_status\s*=\s*'valid'\)/i);
assert.match(verifier, /certificate_issuance_snapshots/i);
assert.match(verifier, /certificate_verifications/i);
assert.match(verifier, /certificate_no|certificate_number/i);

assert.match(legacyImport, /v_public_verification_enabled\s+boolean/i);
assert.match(legacyImport, /p_certificate->>'public_verification_enabled'/i);
assert.match(legacyImport, /public_verification_enabled,\s*verification_enabled/i);
assert.match(legacyImport, /v_public_verification_enabled,\s*v_public_verification_enabled/i);
assert.match(legacyImport, /public_verification_enabled['\s\S]*?::pg_catalog\.boolean,[\s\S]*?true/i);
assert.doesNotMatch(legacyImport, /certificate_issuance_snapshots/i);
assert.match(correctedImport, /::pg_catalog\.bool\b/i);
assert.doesNotMatch(correctedImport, /::pg_catalog\.boolean\b/i);
assert.match(correctiveMigration, /20260924120000/);
assert.match(correctiveMigration, /security definer/i);
assert.match(correctiveMigration, /set search_path\s*=\s*public,\s*app,\s*extensions/i);
assert.match(verificationToggle, /set verification_enabled\s*=\s*p_enabled,\s*public_verification_enabled\s*=\s*p_enabled/i);
assert.match(verificationToggle, /app\.is_active\(\)[\s\S]*?app\.is_admin\(\)[\s\S]*?has_module_access_level\('certificates', 'admin'\)/i);
assert.match(verificationToggle, /where id = p_certificate_id and deleted_at is null[\s\S]*?for update/i);

for (const signature of [
  "public.verify_certificate(text)",
  "public.verify_certificate_by_value(text)",
]) {
  const escaped = signature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.match(migration, new RegExp(`revoke all on function ${escaped} from public, anon, authenticated`, "i"), `legacy verifier remains callable: ${signature}`);
  assert.match(migration, new RegExp(`grant execute on function ${escaped} to service_role`, "i"), `service_role compatibility grant missing: ${signature}`);
}
assert.match(migration, /revoke all on function public\.verify_certificate_by_token\(text\) from public, anon, authenticated, service_role/i);
assert.doesNotMatch(migration, /grant execute on function public\.verify_certificate_by_token\(text\) to service_role/i);

// 2414 must be directly applicable to the verified baseline, without querying
// or requiring migration-ledger rows for 2412/2413.
assert.match(finalStateMigration, /HISTORY INDEPENDENCE/i);
assert.doesNotMatch(finalStateMigration, /supabase_migrations|schema_migrations/i);
assert.match(finalImport, /::pg_catalog\.bool\b/i);
assert.doesNotMatch(finalStateMigration, /::pg_catalog\.boolean\b/i);
assert.match(finalVerifier, /v\.verification_enabled\s+is\s+false/i);
assert.match(finalVerifier, /coalesce\(v\.public_verification_enabled,\s*true\)\s+is\s+false/i);
assert.match(finalVerifier, /v\.status\s+not\s+in\s*\(\s*'valid'\s*,\s*'issued'\s*,\s*'expired'\s*,\s*'revoked'\s*\)/i);
assert.match(finalVerifier, /c\.deleted_at\s+is\s+null/i);
assert.match(finalVerifier, /security\s+definer/i);
assert.match(finalVerifier, /set\s+search_path\s*=\s*pg_catalog/i);
assert.match(finalImport, /security\s+definer/i);
assert.match(finalImport, /set\s+search_path\s*=\s*public,\s*app,\s*extensions/i);
assert.match(finalToggle, /security\s+definer/i);
assert.match(finalToggle, /set\s+search_path\s*=\s*public,\s*app,\s*extensions/i);
assert.match(finalToggle, /set\s+verification_enabled\s*=\s*p_enabled,\s*public_verification_enabled\s*=\s*p_enabled/i);
assert.match(finalToggle, /where\s+id\s*=\s*p_certificate_id\s+and\s+deleted_at\s+is\s+null[\s\S]*?for\s+update/i);
for (const signature of [
  "public.verify_certificate(text)",
  "public.verify_certificate_by_value(text)",
]) {
  const escaped = signature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.match(finalStateMigration, new RegExp(`revoke all on function ${escaped} from public,anon,authenticated`, "i"), `2414 does not harden ${signature}`);
  assert.match(finalStateMigration, new RegExp(`grant execute on function ${escaped} to service_role`, "i"), `2414 removed the compatibility grant for ${signature}`);
}
assert.match(finalStateMigration, /revoke all on function public\.verify_certificate_by_token\(text\) from public,anon,authenticated,service_role/i);
assert.doesNotMatch(finalStateMigration, /grant execute on function public\.verify_certificate_by_token\(text\) to service_role/i);
const finalStateOutsideFunctionBodies = finalStateMigration.replace(/\bas\s+\$\$[\s\S]*?\$\$/gi, "as $BODY$");
assert.doesNotMatch(
  finalStateOutsideFunctionBodies,
  /\b(?:insert\s+into|update|delete\s+from|truncate(?:\s+table)?)\s+public\.(?:certificates|certificate_issuance_snapshots|certificate_verifications|participants|courses)\b/i,
  "2414 must not backfill or mutate certificate/snapshot data",
);
assert.match(finalStateMigration, /\bbegin;[\s\S]*\bcommit;\s*$/i);

for (const fixture of [
  "valid + both flags true",
  "verification_enabled false",
  "public_verification_enabled false",
  "both flags false",
  "legacy import compatibility false",
  "admin toggle false/true",
  "draft",
  "archived",
  "deleted",
  "revoked",
  "expired",
  "valid and issued with expiry in the past",
  "unknown certificate/token",
  "unknown lifecycle state",
  "C2 snapshot-backed",
  "legacy without snapshot",
  "legacy verifier ACL",
  "identity_no public lookup",
]) {
  assert.ok(sqlTest.includes(fixture), `missing SQL contract matrix case: ${fixture}`);
}
assert.match(sqlTest, /\nbegin;\s*do\s*\$\$/i);
assert.match(sqlTest, /rollback;\s*do\s*\$\$/i);
assert.match(sqlTest, /rollback verification succeeded/i);
assert.match(sqlTest, /update\s+public\.certificates\s+set\s+identity_no\s*=\s*'C5B1-SYNTHETIC-IDENTITY-ONLY'/i);
assert.match(sqlTest, /select\s+pg_catalog\.count\(\*\)\s+into\s+v_count\s+from\s+public\.verify_and_log\(\s*'C5B1-SYNTHETIC-IDENTITY-ONLY'\s*,\s*'auto'/i);
assert.match(sqlTest, /if\s+v_count\s*<>\s*0\s+then\s+raise\s+exception\s+'identity_no public lookup closure failed'/i);
assert.match(sqlTest, /from\s+public\.certificate_verifications[\s\S]*?query_value\s*=\s*'C5B1-SYNTHETIC-IDENTITY-ONLY'[\s\S]*?status_returned\s*=\s*'not_found'[\s\S]*?certificate_id\s+is\s+null[\s\S]*?certificate_number\s+is\s+null/i);
assert.match(wrapperSecurityTest, /set\s+local\s+role\s+anon/i);
assert.match(wrapperSecurityTest, /v_wrapper_definer\s+or\s+not\s+v_import_definer/i);
assert.match(wrapperSecurityTest, /has_function_privilege\('anon',\s*v_wrapper,\s*'EXECUTE'\)/i);
assert.ok(wrapperSecurityTest.includes("if pg_catalog.has_function_privilege('anon', v_wrapper, 'EXECUTE') then"), "anon EXECUTE must be explicitly absent");
assert.match(wrapperSecurityTest, /has_function_privilege\('anon',\s*v_import,\s*'EXECUTE'\)/i);
assert.match(wrapperSecurityTest, /has_function_privilege\('authenticated',\s*v_wrapper,\s*'EXECUTE'\)[\s\S]*?has_schema_privilege\('authenticated',\s*'app',\s*'USAGE'\)/i);
assert.doesNotMatch(wrapperSecurityTest, /has_schema_privilege\('anon'/i);
assert.match(wrapperSecurityTest, /perform\s+\*\s+from\s+public\.import_legacy_certificate\(/i);
assert.match(wrapperSecurityTest, /v_state\s*<>\s*'42501'/i);
assert.match(wrapperSecurityTest, /rollback;[\s\S]*?certificate_no\s*=\s*'C5B1-ANON-INVOKER-CONTRACT'/i);
assert.match(migration, /\nbegin;[\s\S]*\ncommit;\s*$/i);
assert.doesNotMatch(migration, /update\s+public\.certificates\s+set\s+verification_enabled\s*=\s*public_verification_enabled/i);

console.log("C5B1 verification-control and 2414 final-state static contracts passed");
