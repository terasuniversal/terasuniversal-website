import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const page = fs.readFileSync(path.join(root, "app/admin/(protected)/attendance/[scheduleId]/page.tsx"), "utf8");
const exportRoute = fs.readFileSync(path.join(root, "app/admin/(protected)/attendance/[scheduleId]/export/route.ts"), "utf8");
const printPage = fs.readFileSync(path.join(root, "app/admin/(protected)/attendance/[scheduleId]/print/page.tsx"), "utf8");
const groupFilter = fs.readFileSync(path.join(root, "app/admin/(protected)/attendance/groupFilter.ts"), "utf8");

assert.match(page, /export\?format=csv&date=\$\{sessionDate\}\$\{requestedGroup/);
assert.match(page, /export\?format=excel&date=\$\{sessionDate\}\$\{requestedGroup/);
assert.match(page, /CSV \(selected date\)/);
assert.match(page, /Excel \(selected date\)/);
assert.match(page, /Print whole schedule/);

assert.match(exportRoute, /loadAttendanceGroups/);
assert.match(exportRoute, /isValidRequestedGroup/);
assert.match(exportRoute, /Invalid attendance group/);
assert.match(exportRoute, /selection === UNGROUPED/);
assert.match(exportRoute, /r\.schedule_group_id === selection\.id/);
assert.match(exportRoute, /schedule_group_id, participants/);
assert.match(exportRoute, /\.neq\("registration_status", "cancelled"\)/);
assert.match(exportRoute, /\.is\("deleted_at", null\)/);
assert.match(printPage, /isValidRequestedGroup/);
assert.match(printPage, /\.is\("deleted_at", null\)/);
assert.match(groupFilter, /isValidRequestedGroup/);

// Regression model for the exact participant-set contract. The application
// query separately excludes cancelled/deleted enrollments; this fixture models
// the resulting active roster and verifies all three group modes do not widen.
const enrollments = [
  { id: "a", group: "A", registration_status: "active", deleted_at: null },
  { id: "b", group: "B", registration_status: "active", deleted_at: null },
  { id: "u", group: null, registration_status: "active", deleted_at: null },
  { id: "cancelled", group: "A", registration_status: "cancelled", deleted_at: null },
  { id: "soft-deleted", group: "A", registration_status: "active", deleted_at: "2026-01-01T00:00:00Z" },
];
const activeRoster = enrollments.filter((row) => row.registration_status !== "cancelled" && row.deleted_at === null);
const select = (group) => activeRoster.filter((row) =>
  group === null ? true : group === "ungrouped" ? row.group === null : row.group === group
).map((row) => row.id);
assert.deepEqual(select(null), ["a", "b", "u"]);
assert.deepEqual(select("A"), ["a"]);
assert.deepEqual(select("ungrouped"), ["u"]);
assert.deepEqual(select("foreign"), []);
assert.equal(new Set(select(null)).size, select(null).length);

const attendanceRows = [
  { participant_id: "a", deleted_at: null },
  { participant_id: "a", deleted_at: "2026-01-01T00:00:00Z" },
];
assert.deepEqual(attendanceRows.filter((row) => row.deleted_at === null).map((row) => row.participant_id), ["a"]);

console.log("Attendance Functional Fix 1 export-scope contract checks passed");