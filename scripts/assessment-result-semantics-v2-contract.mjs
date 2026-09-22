import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const servicePath = path.join(root, "lib/assessment/participantResult.ts");
const pagePath = path.join(root, "app/admin/(protected)/assessment/[scheduleId]/participant-result/[participantId]/page.tsx");
const tablePath = path.join(root, "app/admin/(protected)/assessment/AssessmentTable.tsx");
const legacyParticipantRoute = path.join(root, "app/participant/assessment-result");
const service = fs.readFileSync(servicePath, "utf8");
const page = fs.readFileSync(pagePath, "utf8");
const table = fs.readFileSync(tablePath, "utf8");
const actionsPath = path.join(root, "app/admin/(protected)/assessment/[scheduleId]/participant-result/[participantId]/ParticipantResultActions.tsx");
const stylesPath = path.join(root, "app/admin/admin.css");
const actions = fs.readFileSync(actionsPath, "utf8");
const styles = fs.readFileSync(stylesPath, "utf8");

assert.equal(fs.existsSync(legacyParticipantRoute), false, "direct participant route must be removed");
assert.match(service, /requireAssessment\(false\)/);
assert.match(service, /\.eq\("id", participantId\)/);
assert.match(service, /\.eq\("schedule_id", scheduleId\)/);
assert.match(service, /\.eq\("participant_id", participantId\)/);
assert.match(service, /\.neq\("registration_status", "cancelled"\)/);
assert.match(service, /\.select\("id, participant_id, full_name"\)/);
assert.match(service, /\.select\("theory_result, competency_status, result"\)/);

const assessmentSelect = service.match(/\.from\("assessments"\)[\s\S]*?\.select\("([^"]+)"\)/)?.[1] ?? "";
assert.equal(assessmentSelect, "theory_result, competency_status, result");
assert.doesNotMatch(assessmentSelect, /score|max_score|overall|assessor|locked|remarks/);
assert.doesNotMatch(service, /profile\.email|\.eq\("email"/);
assert.doesNotMatch(service, /internal.*serializer|export\/route/);

for (const forbidden of [
  "theory_score",
  "practical_score",
  "score",
  "max_score",
  "overall_score",
  "Overall (Computed)",
  "assessor_id",
  "locked",
  "locked_at",
  "locked_by",
  "remarks",
]) {
  assert.doesNotMatch(page, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `participant result page must not contain ${forbidden}`);
}

assert.match(page, /ASSESSMENT RESULT/);
assert.match(page, /Theory Assessment/);
assert.match(page, /Practical Assessment/);
assert.match(page, /Overall Result/);
assert.match(table, /participant-result\/\$\{r\.participant_id\}/);
assert.match(actions, /Print \/ Save PDF/);
assert.match(actions, /window\.print\(\)/);
assert.match(styles, /\.ta-participant-result-actions\s*\{[\s\S]*?display: none !important/);
assert.match(styles, /\.ta-participant-result\s*\{\s*min-height: auto !important/);
assert.match(styles, /@page participant-result-page\s*\{\s*size: A4;\s*margin: 0;/);
assert.match(page, /page: "participant-result-page"/);
assert.match(styles, /body:has\(\.ta-participant-result\) \.ta-topbar[\s\S]*?display: none !important/);
assert.match(styles, /body:has\(\.ta-participant-result\) \.ta-sidebar[\s\S]*?display: none !important/);
assert.doesNotMatch(actions, /puppeteer|supabase|pdfjs-dist|jsPDF/i);

const theory = (value) => value === "pass" ? "PASS" : value === "fail" ? "FAIL" : "PENDING";
const practical = (value) => value === "competent" ? "COMPETENT" : value === "not_yet_competent" ? "NOT YET COMPETENT" : "PENDING";
const overall = (value) => value === "pass" ? "PASS" : value === "fail" ? "FAIL" : "PENDING";

assert.deepEqual([theory("pass"), practical("competent"), overall("pass")], ["PASS", "COMPETENT", "PASS"]);
assert.deepEqual([theory("fail"), practical("not_yet_competent"), overall("fail")], ["FAIL", "NOT YET COMPETENT", "FAIL"]);
assert.deepEqual([theory("pending"), practical("pending_review"), overall("pending")], ["PENDING", "PENDING", "PENDING"]);
assert.deepEqual([theory(null), practical(null), overall(null)], ["PENDING", "PENDING", "PENDING"]);

// A foreign participant or cross-schedule combination fails closed because
// both the enrollment and assessment queries require the same pair.
assert.match(service, /\.eq\("schedule_id", scheduleId\)[\s\S]*?\.eq\("participant_id", participantId\)/);
assert.match(service, /if \(enrollmentError \|\| !enrollment\) notFound\(\)/);
assert.match(service, /if \(assessmentError \|\| !assessment\) notFound\(\)/);

console.log("Assessment Result Semantics V2 staff participant-result contract checks passed");
