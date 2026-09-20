import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const actions = fs.readFileSync(path.join(root, "app/admin/(protected)/attendance/actions.ts"), "utf8");
const migration = fs.readFileSync(path.join(root, "supabase/migrations/20260921090000_attendance_active_enrollment_integrity.sql"), "utf8");
const page = fs.readFileSync(path.join(root, "app/admin/(protected)/attendance/[scheduleId]/page.tsx"), "utf8");

const enrollments = [
  { schedule_id: "s1", participant_id: "p1", registration_status: "registered", deleted_at: null },
  { schedule_id: "s2", participant_id: "p2", registration_status: "registered", deleted_at: null },
  { schedule_id: "s1", participant_id: "p3", registration_status: "cancelled", deleted_at: null },
  { schedule_id: "s1", participant_id: "p4", registration_status: "registered", deleted_at: "2026-09-21T00:00:00Z" },
];
const activeIds = (scheduleId, participantIds) => participantIds.filter((participantId) => enrollments.some((row) => (
  row.schedule_id === scheduleId && row.participant_id === participantId && row.deleted_at === null && row.registration_status !== "cancelled"
)));
const assertAccepted = (scheduleId, participantIds) => assert.deepEqual(activeIds(scheduleId, participantIds), participantIds);
const assertRejectedWithoutPartialRows = (scheduleId, participantIds) => {
  const before = [];
  assert.notDeepEqual(activeIds(scheduleId, participantIds), participantIds);
  assert.deepEqual(before, [], "invalid bulk requests must not write a valid subset");
};
assertAccepted("s1", ["p1"]);
assertAccepted("s1", ["p1"]);
assertRejectedWithoutPartialRows("s1", ["p2"]);
assertRejectedWithoutPartialRows("s1", ["missing"]);
assertRejectedWithoutPartialRows("s1", ["p3"]);
assertRejectedWithoutPartialRows("s1", ["p4"]);
assertRejectedWithoutPartialRows("s1", ["p1", "p2"]);
assertRejectedWithoutPartialRows("s1", ["p1", "p3"]);

for (const operation of ["mark", "mark_all_present", "bulk_update", "reset"]) {
  assert.match(actions, new RegExp(`mutationFailure\\(\\"${operation}\\"`), `${operation} must report failures`);
}
assert.match(actions, /schedule_participants/);
assert.match(actions, /deleted_at/);
assert.match(actions, /registration_status.*cancelled/);
assert.match(actions, /new Set\(participantIds\)/);
assert.match(actions, /const \{ error \} = await supabase\.from\("attendance"\)/);
assert.match(migration, /raise exception/);
assert.match(migration, /for update/);
assert.match(migration, /before insert or update on public\.attendance/);
assert.match(migration, /revoke all on function app\.enforce_attendance_active_enrollment/);
assert.match(page, /attendance_error/);
console.log("Attendance Fix 0A contract checks passed");
