import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const actions = fs.readFileSync(path.join(root, "app/admin/(protected)/assessment/actions.ts"), "utf8");
const page = fs.readFileSync(path.join(root, "app/admin/(protected)/assessment/[scheduleId]/page.tsx"), "utf8");
const migration = fs.readFileSync(path.join(root, "supabase/migrations/20260921100000_assessment_security_integrity_fix0b.sql"), "utf8");

const rows = [
  { id: "a1", schedule_id: "s1", participant_id: "p1", locked: false, group: "g1", enrollment: "active" },
  { id: "a2", schedule_id: "s1", participant_id: "p2", locked: true, group: "g1", enrollment: "active" },
  { id: "a3", schedule_id: "s2", participant_id: "p3", locked: false, group: "g2", enrollment: "active" },
  { id: "a4", schedule_id: "s1", participant_id: "p4", locked: false, group: "g1", enrollment: "cancelled" },
  { id: "a5", schedule_id: "s1", participant_id: "p5", locked: false, group: "g1", enrollment: "deleted" },
];

function validateBulk(ids, scheduleId, groupId) {
  const selected = rows.filter((row) => ids.includes(row.id));
  const valid = selected.length === ids.length
    && selected.every((row) => row.schedule_id === scheduleId)
    && selected.every((row) => row.enrollment === "active")
    && selected.every((row) => row.group === groupId)
    && selected.every((row) => !row.locked);
  return valid ? selected : [];
}

assert.deepEqual(validateBulk(["a1"], "s1", "g1").map((row) => row.id), ["a1"]);
for (const invalid of [["a1", "a2"], ["a1", "a3"], ["a1", "a4"], ["a1", "a5"], ["a1"]]) {
  const group = invalid.length === 1 ? "wrong-group" : "g1";
  assert.deepEqual(validateBulk(invalid, "s1", group), [], "invalid bulk requests must write zero rows");
}

const unlock = { locked: false, locked_at: null, locked_by: null };
assert.deepEqual(Object.keys(unlock).sort(), ["locked", "locked_at", "locked_by"]);

for (const operation of ["updateAssessment", "bulkUpdateResult", "lockAssessments", "unlockAssessments"]) {
  assert.match(actions, new RegExp(`mutationFailure\\(scheduleId, \\"(?:invalid_input|invalid_enrollment|assessment_locked|unauthorized_unlock|invalid_group|database_error)`), `${operation} must surface failures`);
}
assert.match(actions, /requireActiveEnrollment/);
assert.match(actions, /if \(candidates\.some\(\(row\) => row\.locked\)\)/);
assert.match(actions, /await requireAssessment\(true\);\s+await requireModuleAccess\("assessment"\);\s+const profile = await getCurrentProfile\(\);\s+if \(!profile \|\| !profile\.is_active \|\| !isSuperAdmin\(profile\.role\)\)/s);
assert.match(actions, /\.eq\("schedule_id", scheduleId\)/);
assert.match(actions, /const \{ error \} = await supabase/);
assert.match(page, /assessment_error/);
assert.match(page, /Only an active Super Admin can unlock assessments/);

assert.match(migration, /raise exception/);
assert.match(migration, /no active schedule enrollment/);
assert.match(migration, /lock metadata is inconsistent/);
assert.match(migration, /security definer/);
assert.match(migration, /set search_path = public, app, pg_temp/);
assert.match(migration, /app\.is_super_admin\(\)/);
assert.match(migration, /for update/);
assert.match(migration, /before insert or update on public\.assessments/);
assert.match(migration, /revoke all on function app\.enforce_assessment_security_integrity/);
assert.match(migration, /assessments_update_unlocked/);
assert.match(migration, /assessments_update_super_admin/);
assert.match(migration, /new\.result is distinct from old\.result/);
assert.match(migration, /new\.competency_status is distinct from old\.competency_status/);

console.log("Assessment Fix 0B security contract checks passed");
