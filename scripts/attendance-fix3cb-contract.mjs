import fs from "node:fs";

const source = fs.readFileSync("app/admin/(protected)/attendance/[scheduleId]/print/page.tsx", "utf8");

const required = [
  ["Name wrapping", ".att-col-name, .att-col-ic { overflow-wrap: anywhere; word-break: break-word; }"],
  ["IC wrapping", ".att-col-ic"],
  ["Remarks wrapping retained", ".att-col-rem { width: 16%; font-size: 10px; overflow-wrap: anywhere; }"],

  ["Fixed table layout", "table-layout: fixed"],
  ["Name width preserved", ".att-col-name { width: 15%; }"],
  ["IC width preserved", ".att-col-ic { width: 12%; }"],
  ["Day width preserved", ".att-col-day { width: 4%;"],
  ["Signature width preserved", ".att-col-sig { width: 14%; }"],
  ["Remarks width preserved", ".att-col-rem { width: 16%;"],
  ["Landscape preserved", "@page { size: A4 landscape;"],
  ["Verification headings preserved", "TRAINER VERIFICATION"],
  ["Assessor verification preserved", "ASSESSOR VERIFICATION"],
  ["Trainer fields preserved", "Trainer Name:"],
  ["Assessor fields preserved", "Assessor Name:"],
  ["Signature fields preserved", "Signature:"],
  ["Date fields preserved", "Date:"],
  ["Footer preserved", "TERAS UNIVERSAL SDN. BHD.</strong> · TRAINING ATTENDANCE SHEET"],
  ["Multi-trainer path preserved", "trainerLines.map"],
  ["Multi-assessor path preserved", "assessorDisplay.entries.map"],
];

for (const [label, needle] of required) {
  if (!source.includes(needle)) throw new Error(`Missing ${label}: ${needle}`);
}

if (source.includes("text-overflow: ellipsis") || source.includes(".att-col-name { overflow: hidden") || source.includes(".att-col-ic { overflow: hidden")) {
  throw new Error("Fix 3C-B must not truncate or hide Name/IC values");
}

console.log("Attendance Functional Fix 3C-B contract checks passed");