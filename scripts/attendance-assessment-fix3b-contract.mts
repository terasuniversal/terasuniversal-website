import assert from "node:assert/strict";
import fs from "node:fs";

const attendance = fs.readFileSync("app/admin/(protected)/attendance/AttendanceTable.tsx", "utf8");
const assessment = fs.readFileSync("app/admin/(protected)/assessment/AssessmentTable.tsx", "utf8");
const css = fs.readFileSync("app/admin/admin.css", "utf8");

assert.match(attendance, /ta-attendance-mobile/);
assert.match(attendance, /Status for \$\{/);
assert.match(attendance, /Check-in for \$\{/);
assert.match(attendance, /MutationForm action=\{markForDate\}/);
assert.match(attendance, /utcIsoToMalaysiaDateTimeLocal/);

assert.match(assessment, /ta-assessment-mobile/);
assert.match(assessment, /aria-expanded=\{isExpanded\}/);
assert.match(assessment, /assessment-details-\$\{r\.participant_id\}/);
assert.match(assessment, /Select \$\{participantName\}/);
assert.match(assessment, /<small>Result<\/small>/);
assert.match(assessment, /<small>Competency<\/small>/);
assert.match(assessment, /This assessment is locked and read-only/);
assert.match(assessment, /MutationForm action=\{updateAssessment\.bind\(null, scheduleId\)\}/);

assert.match(css, /@media \(max-width: 820px\)/);
assert.match(css, /ta-attendance-mobile-form/);
assert.match(css, /min-height: 44px/);

const responsiveBlock = css.slice(css.indexOf("/* Training Operations responsive rows"), css.indexOf("/* --- Badges"));
assert.ok(!/print-color-adjust|@media print/.test(responsiveBlock), "Fix 3B responsive styles must not add print rules");
console.log("Attendance/Assessment Functional Fix 3B contracts passed");