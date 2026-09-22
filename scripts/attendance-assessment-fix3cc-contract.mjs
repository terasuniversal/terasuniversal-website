import fs from "node:fs";

const attendance = fs.readFileSync("app/admin/(protected)/attendance/[scheduleId]/print/page.tsx", "utf8");
const assessment = fs.readFileSync("app/admin/(protected)/assessment/[scheduleId]/export/route.ts", "utf8");

const required = [
  ["Attendance shared company config", attendance, "COMPANY_DOCUMENT_CONFIG"],
  ["Attendance official logo", attendance, "/teras-universal-logo.png"],
  ["Attendance corporate identity", attendance, "Company Registration No."],
  ["Attendance right title", attendance, "TRAINING ATTENDANCE SHEET"],
  ["Attendance white corporate surface", attendance, "background: #fff"],
  ["Attendance restrained divider", attendance, "border-bottom: 3px solid var(--att-gold)"],
  ["Attendance contain logo", attendance, "object-fit: contain"],
  ["Attendance left-positioned logo", attendance, "object-position: left center"],
  ["Assessment shared company config", assessment, "COMPANY_DOCUMENT_CONFIG"],
  ["Assessment official logo", assessment, "/teras-universal-logo.png"],
  ["Assessment corporate identity", assessment, "Company Registration No."],
  ["Assessment right title", assessment, "ASSESSMENT RESULT"],
  ["Assessment continuation logo", assessment, "asm-continued-logo"],
  ["Assessment page labels", assessment, "Page ${pageIndex + 1} of ${printPages.length}"],
  ["Measured full header budget", assessment, "FULL_HEADER_MM = 49"],
  ["Measured continuation budget", assessment, "CONTINUATION_HEADER_MM = 18"],
  ["Fix 3C-A estimator retained", assessment, "estimateAssessmentRowHeightMm"],
  ["Fix 3C-A paginator retained", assessment, "paginateAssessmentRows"],
];

for (const [label, source, needle] of required) {
  if (!source.includes(needle)) throw new Error(`Missing ${label}: ${needle}`);
}

const preserved = [
  ["Attendance Name width", attendance, ".att-col-name { width: 15%; }"],
  ["Attendance IC width", attendance, ".att-col-ic { width: 12%; }"],
  ["Attendance day width", attendance, ".att-col-day { width: 4%;"],
  ["Attendance signature width", attendance, ".att-col-sig { width: 14%; }"],
  ["Attendance Remarks width", attendance, ".att-col-rem { width: 16%;"],
  ["Attendance fixed layout", attendance, "table-layout: fixed"],
  ["Attendance landscape", attendance, "@page { size: A4 landscape;"],
  ["Attendance verification", attendance, "TRAINER VERIFICATION"],
  ["Assessment signatory", assessment, "ASSESSOR VERIFICATION"],
];

for (const [label, source, needle] of preserved) {
  if (!source.includes(needle)) throw new Error(`Regression in ${label}: ${needle}`);
}

if (attendance.includes(".att-head-logo {\n  height:") || attendance.includes("background: #fff; border-radius: 6px; padding: 4px")) {
  throw new Error("Attendance logo must not use the previous white logo-box treatment");
}

console.log("Training Operations Functional Fix 3C-C contract checks passed");