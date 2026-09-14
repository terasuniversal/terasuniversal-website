import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = pathToFileURL(resolve(repoRoot, "public")).href;
const out = resolve(process.env.QA_OUTPUT_DIR ?? resolve(repoRoot, "..", "_qa", "certificate-c5-signature-seal"));

const { renderCertificateFront, renderCertificateBack } = await import(
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
  certificate_number: "SYNTH-C5-2026-000001",
  holder_name: "AMIRUL HAKIM BIN RAHMAN",
  course_name: "INTERMEDIATE SCAFFOLDING ERECTOR",
  programme_duration: "3 DAYS",
  training_date: "2026-09-08",
  training_end_date: "2026-09-10",
  issue_date: "2026-09-10",
  venue: "TERAS Training Centre",
  participant_id: "SYN-C5-001",
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
  ["intermediate-erector-c5-page1", base, { ...common, design_variant: "standard_scaffold_certificate", watermark_level: "intermediate" }, "front"],
  ["intermediate-erector-c5-page2", base, { ...common, design_variant: "standard_scaffold_certificate", watermark_level: "intermediate" }, "back"],
  ["wah-c5-page1", { ...base, certificate_number: "SYNTH-C5-WAH", course_name: "WORKING AT HEIGHT SAFETY" }, { ...common, design_variant: "working_at_height_certificate", wah_watermark: true }, "front"],
];
function rewriteAssets(body) {
  return body
    .replaceAll("/certificates/watermarks/", `${publicRoot}/certificates/watermarks/`)
    .replaceAll('src="/certificates/template-a/', `src="${publicRoot}/certificates/template-a/`)
    .replaceAll('src="/signatures/director-signature.png', `src="${publicRoot}/signatures/director-signature.png`)
    .replaceAll('src="/certificates/seals/teras-common-seal.png', `src="${publicRoot}/certificates/seals/teras-common-seal.png`);
}
function documentHtml(body) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:A4 portrait;margin:0}html,body{margin:0;padding:0;background:#fff}@media print{*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}}</style></head><body>${body}</body></html>`;
}
for (const [name, data, config, page] of specs) {
  const body = page === "back" ? renderCertificateBack(data, config) : renderCertificateFront(data, config);
  writeFileSync(resolve(out, `${name}.html`), documentHtml(rewriteAssets(body)), "utf8");
}
const professionalConfig = { ...common, design_variant: "professional_scaffold_erection_skills", watermark_level: "advanced" };
const professionalBody = rewriteAssets(renderCertificateFront({ ...base, certificate_number: "SYNTH-C5-PRO", course_name: "TERAS PROFESSIONAL SCAFFOLD ERECTION SKILLS PROGRAMME" }, professionalConfig));
writeFileSync(resolve(out, "professional-c5-page1.html"), documentHtml(professionalBody), "utf8");
const intermediateDocument = rewriteAssets(renderCertificateFront(base, { ...common, design_variant: "standard_scaffold_certificate", watermark_level: "intermediate" })) + rewriteAssets(renderCertificateBack(base, { ...common, design_variant: "standard_scaffold_certificate", watermark_level: "intermediate" }));
writeFileSync(resolve(out, "intermediate-erector-c5-document.html"), documentHtml(intermediateDocument), "utf8");
console.log(`generated ${specs.length + 1} C5 source fixtures in ${out}`);
