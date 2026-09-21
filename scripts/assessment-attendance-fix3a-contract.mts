import assert from "node:assert/strict";
import fs from "node:fs";
import { malaysiaDateTimeLocalToUtcIso, utcIsoToMalaysiaDateTimeLocal } from "../lib/malaysia-date-time.ts";

const attendanceActions = fs.readFileSync("app/admin/(protected)/attendance/actions.ts", "utf8");
const attendanceTable = fs.readFileSync("app/admin/(protected)/attendance/AttendanceTable.tsx", "utf8");
const attendancePage = fs.readFileSync("app/admin/(protected)/attendance/[scheduleId]/page.tsx", "utf8");
const assessmentActions = fs.readFileSync("app/admin/(protected)/assessment/actions.ts", "utf8");
const assessmentTable = fs.readFileSync("app/admin/(protected)/assessment/AssessmentTable.tsx", "utf8");
const mutationForm = fs.readFileSync("components/admin/MutationForm.tsx", "utf8");

assert.equal(malaysiaDateTimeLocalToUtcIso("2026-09-21T09:00"), "2026-09-21T01:00:00.000Z");
assert.equal(malaysiaDateTimeLocalToUtcIso("2026-01-01T00:30"), "2025-12-31T16:30:00.000Z");
assert.equal(utcIsoToMalaysiaDateTimeLocal("2026-09-21T01:00:00.000Z"), "2026-09-21T09:00");
assert.equal(utcIsoToMalaysiaDateTimeLocal("2025-12-31T16:30:00.000Z"), "2026-01-01T00:30");
assert.throws(() => malaysiaDateTimeLocalToUtcIso("2026-02-30T09:00"));
assert.throws(() => malaysiaDateTimeLocalToUtcIso("2026-09-21T24:00"));
assert.throws(() => malaysiaDateTimeLocalToUtcIso("not-a-datetime"));

for (const source of [attendanceTable, assessmentTable]) {
  assert.match(source, /MutationSubmitButton/);
  assert.match(source, /pendingLabel=/);
}
assert.match(attendanceActions, /Attendance saved\./);
assert.match(attendanceActions, /Attendance updated\./);
assert.match(attendanceActions, /Attendance reset\./);
assert.match(attendanceActions, /malaysiaDateTimeLocalToUtcIso/);
assert.match(attendancePage, /invalid_date/);
assert.match(attendancePage, /invalid_input/);
assert.match(attendancePage, /No change was confirmed/);
assert.match(assessmentActions, /Assessment saved\./);
assert.match(assessmentActions, /Results updated\./);
assert.match(assessmentActions, /Assessment locked\./);
assert.match(assessmentActions, /Assessment unlocked\./);
assert.match(assessmentActions, /Skills record could not be saved\. No change was confirmed/);
assert.doesNotMatch(assessmentActions, /return \{ error: error\.message \}/);
assert.match(mutationForm, /role="status"/);
assert.match(mutationForm, /role="alert"/);
assert.match(mutationForm, /disabled=\{mutation\.pending\}/);

console.log("Assessment/Attendance Functional Fix 3A contracts passed");
