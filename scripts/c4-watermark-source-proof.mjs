import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = pathToFileURL(resolve(repoRoot, "public")).href;
const out = resolve(process.env.QA_OUTPUT_DIR ?? resolve(repoRoot, "..", "_qa", "certificate-c4-watermark-design-system"));

const { renderCertificateDocument, renderCertificateFront, renderCertificateBack } = await import(
  pathToFileURL(resolve(repoRoot, "lib/certificate-html.ts")).href,
);
const { resolveCertificateSkills } = await import(
  pathToFileURL(resolve(repoRoot, "lib/certificate-skills.ts")).href,
);

mkdirSync(out, { recursive: true });
const logo = `${publicRoot}/certificates/template-a/teras-symbol-v2.png`;
const qr = '<svg viewBox="0 0 29 29" xmlns="http://www.w3.org/2000/svg"><rect width="29" height="29" fill="white"/><path fill="#0b1f3a" d="M1 1h9v9H1zM3 3v5h5V3zM19 1h9v9h-9zM21 3v5h5V3zM1 19h9v9H1zM3 21v5h5v-5zM13 1h3v3h-3zM12 7h4v3h-4zM12 12h3v3h-3zM17 12h3v3h-3zM22 12h3v3h-3zM13 17h4v4h-4zM19 18h3v3h-3zM24 17h4v4h-4zM12 24h3v4h-3zM17 24h3v3h-3zM22 23h3v5h-3z"/></svg>';
const skills = resolveCertificateSkills(true, [
  { area: "theory_session", status: "completed" },
  { area: "practical_training", status: "completed" },
  { area: "safety_awareness", status: "completed" },
  { area: "practical_assessment", status: "passed" },
  { area: "attendance_requirement", status: "met" },
]).skills;
const base = {
  certificate_number: "SYNTH-C4-WM-0001",
  holder_name: "AMIRUL HAKIM BIN RAHMAN",
  course_name: "SCAFFOLDING COMPETENCY PROGRAMME",
  programme_duration: "3 DAYS",
  training_date: "2026-09-08",
  training_end_date: "2026-09-10",
  issue_date: "2026-09-10",
  venue: "TERAS Training Centre",
  participant_id: "SYN-WM-001",
  ic_passport: "P123456789012345678901234567890",
  qr_svg: qr,
  skills,
};
const common = {
  logo_url: logo,
  signature_layout: "single",
  signature_name: "Authorised Director",
  signature_title: "Director",
  body_text: "This certificate records the training outcome under the approved template and course contract.",
  objectives_text: "Synthetic programme objective for browser visual review.",
  coverage_items: ["Scaffold components and safe erection sequence", "Inspection of bays, braces and working platforms"],
  learning_outcomes: ["Apply approved practical procedures", "Recognise relevant workplace hazards"],
  assessment_methods: ["Attendance", "Theory learning", "Practical assessment"],
  primary_color: "#0b1f3a",
  accent_color: "#c9a227",
};
const specs = [
  ["01-erector-basic-page1", { ...base, course_name: "BASIC SCAFFOLDING ERECTOR" }, { ...common, design_variant: "standard_scaffold_certificate", watermark_level: "basic" }, "front"],
  ["02-erector-intermediate-page1", { ...base, course_name: "INTERMEDIATE SCAFFOLDING ERECTOR" }, { ...common, design_variant: "standard_scaffold_certificate", watermark_level: "intermediate" }, "front"],
  ["03-erector-advanced-page1", { ...base, course_name: "ADVANCED SCAFFOLDING ERECTOR" }, { ...common, design_variant: "standard_scaffold_certificate", watermark_level: "advanced" }, "front"],
  ["04-inspector-basic-page1", { ...base, course_name: "BASIC SCAFFOLDING INSPECTOR" }, { ...common, design_variant: "standard_scaffold_certificate", inspector_watermark_level: "basic" }, "front"],
  ["05-inspector-intermediate-page1", { ...base, course_name: "INTERMEDIATE SCAFFOLDING INSPECTOR" }, { ...common, design_variant: "standard_scaffold_certificate", inspector_watermark_level: "intermediate" }, "front"],
  ["06-inspector-advanced-page1", { ...base, course_name: "ADVANCED SCAFFOLDING INSPECTOR" }, { ...common, design_variant: "standard_scaffold_certificate", inspector_watermark_level: "advanced" }, "front"],
  ["07-working-at-height-page1", { ...base, certificate_number: "SYNTH-C4-WM-WAH", course_name: "WORKING AT HEIGHT SAFETY" }, { ...common, design_variant: "working_at_height_certificate", wah_watermark: true }, "front"],
  ["08-professional-page1", { ...base, certificate_number: "SYNTH-C4-WM-PRO", course_name: "TERAS PROFESSIONAL SCAFFOLD ERECTION SKILLS PROGRAMME" }, { ...common, design_variant: "professional_scaffold_erection_skills", watermark_level: "advanced" }, "front"],
  ["09-erector-intermediate-page2", { ...base, certificate_number: "SYNTH-C4-WM-0002", course_name: "INTERMEDIATE SCAFFOLDING ERECTOR" }, { ...common, design_variant: "standard_scaffold_certificate", watermark_level: "intermediate" }, "back"],
  ["10-working-at-height-page2", { ...base, certificate_number: "SYNTH-C4-WM-WAH2", course_name: "WORKING AT HEIGHT SAFETY" }, { ...common, design_variant: "working_at_height_certificate", wah_watermark: true }, "back"],
];
function documentHtml(body) {
  // The application emits public-root URLs. This local proof only rewrites
  // those URLs to the exact checked-out public directory for file:// Chromium.
  const localBody = body.replaceAll("/certificates/watermarks/", `${publicRoot}/certificates/watermarks/`);
  return `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:A4 portrait;margin:0}html,body{margin:0;padding:0;background:#fff}@media print{*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}}</style></head><body>${localBody}</body></html>`;
}
for (const [name, data, config, page] of specs) {
  const body = page === "back" ? renderCertificateBack(data, config) : renderCertificateFront(data, config);
  writeFileSync(resolve(out, `${name}.html`), documentHtml(body), "utf8");
}
const intermediateConfig = { ...common, design_variant: "standard_scaffold_certificate", watermark_level: "intermediate" };
const intermediateDocument = renderCertificateDocument(
  { ...base, course_name: "INTERMEDIATE SCAFFOLDING ERECTOR" },
  intermediateConfig,
).replaceAll("/certificates/watermarks/", `${publicRoot}/certificates/watermarks/`);
writeFileSync(resolve(out, "11-intermediate-erector-document.html"), intermediateDocument, "utf8");
console.log(`generated ${specs.length} watermark source fixtures in ${out}`);
