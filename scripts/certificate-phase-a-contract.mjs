import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const migration = (await read("supabase/migrations/20260929120001_certificate_issuing_branch_binding.sql")).toLowerCase();
const scheduleActions = await read("app/admin/(protected)/schedules/actions.ts");
const scheduleForm = await read("app/admin/(protected)/schedules/ScheduleForm.tsx");
const schema = await read("lib/validation/schemas.ts");
const issuer = (await read("supabase/migrations/20260922160000_certificates_v2_dependency_unblock.sql")).toLowerCase();
const issueActions = await read("app/admin/(protected)/certificates/actions.ts");
const reasons = await read("lib/certificate-issuance-reasons.ts");
const generatePage = await read("app/admin/(protected)/certificates/generate/[scheduleId]/page.tsx");

assert.match(migration, /where\s+b\.branch_code\s*=\s*'hq'\s+and\s+b\.is_active/,
  "branch resolver must select only the active canonical HQ branch");
assert.match(migration, /on conflict\s*\(branch_code\)\s*do nothing/,
  "canonical HQ seed must reuse an existing natural-key row");
assert.match(migration, /branch_name = 'teras universal sdn\. bhd\.'/,
  "migration must verify the canonical HQ business identity before completion");
assert.match(migration, /certificate_branches_code_key/,
  "migration must fail closed if branch_code is not unique");
assert.match(migration, /where branch_id is null and deleted_at is null/,
  "backfill must be limited to live schedules with no branch");
assert.doesNotMatch(migration, /update\s+public\.certificates\b|update\s+public\.certificate_issuance_snapshots\b/,
  "branch binding must not rewrite issued certificates or historical snapshots");
assert.match(migration, /alter column branch_id set default app\.default_schedule_branch_id\(\)/,
  "new rows omitting branch_id must receive the database default");
assert.match(migration, /before insert or update of branch_id, deleted_at/,
  "database guard must cover explicit NULL and branch updates");
assert.match(migration, /new\.branch_id is distinct from v_default_branch_id/,
  "new or changed noncanonical assignments must fail closed");
assert.match(migration, /branch resolver security contract is incorrect/,
  "resolver owner, SECURITY DEFINER, search_path, and ACL must be asserted");
assert.match(migration, /branch trigger function security contract is incorrect/,
  "trigger function owner, SECURITY DEFINER, search_path, and ACL must be asserted");
assert.match(migration, /existing issuer branch validation is not present/,
  "migration must refuse to proceed if the existing issuer guard is absent");

assert.match(issuer, /if v_schedule\.branch_id is null then[\s\S]*?certificate issuing branch is not configured\./,
  "existing issuer NULL-branch rejection must remain in source");
assert.match(issuer, /where b\.id = v_schedule\.branch_id and b\.is_active[\s\S]*?certificate issuing branch is inactive or missing\./,
  "existing issuer active-branch rejection must remain in source");
assert.doesNotMatch(scheduleForm, /name=["']branch_id["']/i,
  "fixed-HQ operating model does not need an admin branch selector");
assert.doesNotMatch(schema, /branch_id\s*:/,
  "schedule form payload must not send a branch_id that could null the database default");
for (const action of ["createSchedule", "updateSchedule", "duplicateSchedule"]) {
  assert.ok(scheduleActions.includes(`export async function ${action}`), `${action} must remain present`);
}
assert.match(scheduleActions, /\.insert\(payload\)/,
  "normal schedule creation should omit branch_id and use the database default");
assert.match(scheduleActions, /\.update\(clean\(scheduleData\)\)/,
  "normal schedule edits should preserve the existing branch assignment");
assert.match(scheduleActions, /course_id: s\.course_id[\s\S]*?status: "open"/,
  "schedule duplication must omit branch_id and use the database default");

for (const reason of ["branch-not-configured", "branch-inactive", "trainer-not-configured", "template-invalid", "permission-denied", "already-certified", "system-error"]) {
  assert.ok(reasons.includes(`"${reason}"`), `stable UI mapping must include ${reason}`);
}
assert.match(issueActions, /console\.error\("Certificate issuance RPC failed"[\s\S]*?message,/,
  "raw RPC diagnostics must remain server-side for troubleshooting");
assert.match(issueActions, /return "system-error"/,
  "unknown issuance failures must map to a stable generic reason");
assert.match(generatePage, /issuanceReasonLabel\(query\.reason\)/,
  "untrusted query-string reasons must map to safe display labels");
assert.match(reasons, /\?\?\s*ISSUANCE_REASON_LABEL\["system-error"\]/,
  "unknown reason strings must not be echoed into the browser");

console.log("Certificate Phase A source contract: PASS");
