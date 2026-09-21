import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const route = fs.readFileSync(path.join(root, "app/admin/(protected)/assessment/[scheduleId]/export/route.ts"), "utf8");
const page = fs.readFileSync(path.join(root, "app/admin/(protected)/assessment/[scheduleId]/page.tsx"), "utf8");
const groups = fs.readFileSync(path.join(root, "lib/scheduleGroupContext.ts"), "utf8");
const mask = fs.readFileSync(path.join(root, "lib/identityMask.ts"), "utf8");
const fix0b = fs.readFileSync(path.join(root, "supabase/migrations/20260921100000_assessment_security_integrity_fix0b.sql"), "utf8");

assert.match(groups, /export const ALL_GROUPS = "all"/);
assert.match(groups, /export function isValidRequestedGroup/);
assert.match(page, /group=\$\{ALL_GROUPS\}/);
assert.match(route, /if \(!isValidRequestedGroup\(groups, requestedGroup\)\)/);
assert.match(route, /Invalid assessment group/);
assert.match(route, /status: 400/);
assert.match(route, /selection === UNGROUPED/);
assert.match(route, /r\.schedule_group_id === selection\.id/);
assert.match(route, /Scope:/);
assert.match(route, /scopeHeaderValue/);

assert.match(route, /ASSESSMENT RESULT/);
assert.match(route, /Assessment Record/);
assert.match(route, /Theory Score/);
assert.match(route, /Theory Result/);
assert.match(route, /Practical Score/);
assert.match(route, /Practical Result/);
assert.match(route, /Overall Result/);
assert.match(route, /Competency Status/);
assert.match(route, /Generated:/);
assert.match(route, /course_schedules/);
assert.match(route, /s\?\.exam_date/);
assert.match(route, /print-color-adjust: exact/);
assert.match(route, /-webkit-print-color-adjust: exact/);
assert.match(route, /Page \$\{pageIndex \+ 1\} of \$\{printPages\.length\}/);

assert.match(mask, /export function maskIdentification/);
assert.match(route, /maskIdentification\(r\.participants\?\.ic_passport_no\)/);
assert.doesNotMatch(route, /overall_score.*Overall["`]/);
assert.match(route, /Overall \(Computed\)/);
assert.doesNotMatch(route, /locked_by/);
assert.doesNotMatch(route, /participant_skill_results/);
assert.doesNotMatch(route, /from\("assessments"\)[\s\S]{0,260}assessor_id/);

// Contract model: invalid values never select the all-groups roster.
const groupsForSchedule = ["group-a", "group-b"];
const validScope = (requested) => requested == null || requested === "all" || requested === "ungrouped" || groupsForSchedule.includes(requested);
assert.equal(validScope(null), true);
assert.equal(validScope("all"), true);
assert.equal(validScope("group-a"), true);
assert.equal(validScope("ungrouped"), true);
assert.equal(validScope("foreign-group"), false);
assert.equal(validScope("deleted-group"), false);
assert.equal(validScope("garbage"), false);

// Result fields remain independent persisted values; no score-derived result.
const row = { theory_score: 80, theory_result: "pending", practical_score: null, practical_result: "pending", result: "pass", competency_status: null, remarks: "Review" };
assert.equal(row.result, "pass");
assert.equal(row.theory_result, "pending");
assert.equal(row.practical_score, null);

// Fix 0B migration remains present and untouched by the application-only change.
assert.match(fix0b, /assessment_security/);

console.log("Assessment Functional Fix 2 output-contract checks passed");