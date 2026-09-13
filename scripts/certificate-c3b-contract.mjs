import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveCertificateSkills } from "../lib/certificate-skills.ts";

const complete = [
  { area: "theory_session", status: "completed" },
  { area: "practical_training", status: "completed" },
  { area: "safety_awareness", status: "completed" },
  { area: "practical_assessment", status: "passed" },
  { area: "attendance_requirement", status: "met" },
];

const modern = resolveCertificateSkills(true, complete);
assert.equal(modern.provenance, "MODERN_SNAPSHOT");
assert.equal(modern.completeness, "FULL");
assert.deepEqual(modern.skills.map((row) => row.status), ["Completed", "Completed", "Completed", "Passed", "Met"]);

const legacy = resolveCertificateSkills(false, complete);
assert.equal(legacy.provenance, "LEGACY_DEFENSIBLE_SKILLS");
assert.equal(legacy.completeness, "FULL");
assert.equal(legacy.skills[3].status, "Passed");

const fallback = resolveCertificateSkills(false, []);
assert.equal(fallback.provenance, "LEGACY_FALLBACK");
assert.equal(fallback.completeness, "NONE");
assert.ok(fallback.skills.every((row) => row.status === "Not Recorded"));

const partial = resolveCertificateSkills(true, complete.slice(0, 2));
assert.equal(partial.provenance, "PARTIAL_SKILL_RECORD");
assert.equal(partial.completeness, "PARTIAL");
assert.deepEqual(partial.skills.map((row) => row.status), ["Completed", "Completed", "Not Recorded", "Not Recorded", "Not Recorded"]);

const negative = resolveCertificateSkills(false, complete.map((row) => row.area === "practical_assessment"
  ? { ...row, status: "failed" }
  : row.area === "attendance_requirement"
    ? { ...row, status: "not_met" }
    : row));
assert.equal(negative.skills[3].status, "Failed");
assert.equal(negative.skills[4].status, "Not Met");

const certDataSource = readFileSync(new URL("../app/admin/(protected)/certificates/certData.ts", import.meta.url), "utf8");
assert.doesNotMatch(certDataSource, /from\(["']participant_skill_results["']\)/);
assert.doesNotMatch(certDataSource, /from\(["']v_certificate_eligibility["']\)/);
assert.doesNotMatch(certDataSource, /buildParticipantSkillsRecord|participantSkillsRecord/);

for (const renderer of [
  "../components/admin/CertificateDocument.tsx",
  "../components/admin/ProfessionalScaffoldCertificateDocument.tsx",
  "../lib/certificate-html.ts",
  "../lib/professional-scaffold-certificate-html.ts",
]) {
  assert.match(readFileSync(new URL(renderer, import.meta.url), "utf8"), /data\.skills\?\.length/);
}

console.log("C3B provenance contract passed: four modes, negative statuses, no live certificate fallback, React/HTML shared model.");
