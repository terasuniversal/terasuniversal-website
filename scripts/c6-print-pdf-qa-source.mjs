import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import QRCode from "qrcode";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = pathToFileURL(resolve(repoRoot, "public")).href;
const out = resolve(process.env.QA_OUTPUT_DIR ?? resolve(repoRoot, "..", "_qa", "certificate-c6-print-pdf-qa"));

const { renderCertificateDocument, renderCertificateFront, renderCertificateBack } = await import(
  pathToFileURL(resolve(repoRoot, "lib/certificate-html.ts")).href,
);
const { resolveCertificateSkills } = await import(
  pathToFileURL(resolve(repoRoot, "lib/certificate-skills.ts")).href,
);
const { renderProfessionalScaffoldCertificateFront, renderProfessionalScaffoldCertificateBack } = await import(
  pathToFileURL(resolve(repoRoot, "lib/professional-scaffold-certificate-html.ts")).href,
);

mkdirSync(out, { recursive: true });
const logo = `${publicRoot}/certificates/template-a/teras-symbol-v2.png`;

const skills = resolveCertificateSkills(true, [
  { area: "theory_session", status: "completed" },
  { area: "practical_training", status: "completed" },
  { area: "safety_awareness", status: "completed" },
  { area: "practical_assessment", status: "passed" },
  { area: "attendance_requirement", status: "met" },
]).skills;
const common = {
  logo_url: logo,
  signature_layout: "single",
  signature_name: "Authorised Director",
  signature_title: "Director",
  body_text: "Synthetic C6 print and PDF QA fixture. No production data.",
  objectives_text: "Synthetic programme objective for local browser QA.",
  coverage_items: ["Scaffold components and safe erection sequence", "Inspection of bays, braces and working platforms"],
  learning_outcomes: ["Apply approved practical procedures", "Recognise relevant workplace hazards"],
  assessment_methods: ["Attendance", "Theory learning", "Practical assessment"],
  primary_color: "#0b1f3a",
  accent_color: "#c9a227",
};
const base = {
  certificate_number: "SYNTH-C6-2026-000001",
  holder_name: "AMIRUL HAKIM BIN RAHMAN",
  course_name: "INTERMEDIATE SCAFFOLDING ERECTOR",
  programme_duration: "3 DAYS",
  training_date: "2026-09-08",
  training_end_date: "2026-09-10",
  issue_date: "2026-09-10",
  venue: "TERAS Training Centre",
  participant_id: "SYNTH-C6-001",
  ic_passport: "P123456789012345678901234567890",
  skills,
};
const familySpecs = [
  ["basic-erector", { ...base, certificate_number: "SYNTH-C6-ERE-B", course_name: "BASIC SCAFFOLDING ERECTOR" }, { ...common, design_variant: "standard_scaffold_certificate", watermark_level: "basic" }],
  ["intermediate-erector", base, { ...common, design_variant: "standard_scaffold_certificate", watermark_level: "intermediate" }],
  ["advanced-erector", { ...base, certificate_number: "SYNTH-C6-ERE-A", course_name: "ADVANCED SCAFFOLDING ERECTOR" }, { ...common, design_variant: "standard_scaffold_certificate", watermark_level: "advanced" }],
  ["basic-inspector", { ...base, certificate_number: "SYNTH-C6-INS-B", course_name: "BASIC SCAFFOLDING INSPECTOR" }, { ...common, design_variant: "standard_scaffold_certificate", inspector_watermark_level: "basic" }],
  ["intermediate-inspector", { ...base, certificate_number: "SYNTH-C6-INS-I", course_name: "INTERMEDIATE SCAFFOLDING INSPECTOR" }, { ...common, design_variant: "standard_scaffold_certificate", inspector_watermark_level: "intermediate" }],
  ["advanced-inspector", { ...base, certificate_number: "SYNTH-C6-INS-A", course_name: "ADVANCED SCAFFOLDING INSPECTOR" }, { ...common, design_variant: "standard_scaffold_certificate", inspector_watermark_level: "advanced" }],
  ["working-at-height", { ...base, certificate_number: "SYNTH-C6-WAH", course_name: "WORKING AT HEIGHT SAFETY" }, { ...common, design_variant: "working_at_height_certificate", wah_watermark: true }],
  ["professional-programme", { ...base, certificate_number: "SYNTH-C6-PRO", course_name: "TERAS PROFESSIONAL SCAFFOLD ERECTION SKILLS PROGRAMME" }, { ...common, design_variant: "professional_scaffold_erection_skills", watermark_level: "advanced" }],
];
const stressData = {
  ...base,
  certificate_number: "SYNTH-C6-TERAS-2026-000001",
  holder_name: "MUHAMMAD ABDUL RAHMAN BIN MOHD ZAKARIA AL-HADDI",
  course_name: "TERAS PROFESSIONAL SCAFFOLD ERECTION, INSPECTION AND WORKING-AT-HEIGHT COMPETENCY PROGRAMME",
  ic_passport: "A12345678901234567890123456789012345678901234567890",
  venue: "TERAS UNIVERSAL SDN. BHD. Advanced Scaffolding and Height Safety Training Centre, Kuala Lumpur",
  training_date: "2026-09-08",
  training_end_date: "2026-09-19",
};
const stressConfig = { ...common, design_variant: "standard_scaffold_certificate", watermark_level: "advanced" };

function rewriteAssets(body) {
  return body
    .replaceAll("/certificates/watermarks/", `${publicRoot}/certificates/watermarks/`)
    .replaceAll('src="/signatures/director-signature.png', `src="${publicRoot}/signatures/director-signature.png`)
    .replaceAll('src="/certificates/seals/teras-common-seal.png', `src="${publicRoot}/certificates/seals/teras-common-seal.png`)
    .replaceAll('src="/certificates/template-a/', `src="${publicRoot}/certificates/template-a/`);
}
function shell(body, grayscale = false) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:A4 portrait;margin:0}html,body{margin:0;padding:0;background:#fff}@media print{*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}}${grayscale ? "html{filter:grayscale(1)}" : ""}</style></head><body>${body}</body></html>`;
}
for (const [name, data, config] of familySpecs) {
  const qr_svg = await QRCode.toString(`https://www.terasuniversal.com.my/verify/${data.certificate_number}`, { type: "svg", margin: 1, color: { dark: "#0b1f3a", light: "#ffffff" } });
  const qaData = { ...data, qr_svg };
  const renderFront = config.design_variant === "professional_scaffold_erection_skills" ? renderProfessionalScaffoldCertificateFront : renderCertificateFront;
  const renderBack = config.design_variant === "professional_scaffold_erection_skills" ? renderProfessionalScaffoldCertificateBack : renderCertificateBack;
  writeFileSync(resolve(out, `${name}-page1.html`), shell(rewriteAssets(renderFront(qaData, config))), "utf8");
  writeFileSync(resolve(out, `${name}-page2.html`), shell(rewriteAssets(renderBack(qaData, config))), "utf8");
  writeFileSync(resolve(out, `${name}.html`), shell(rewriteAssets(renderCertificateDocument(qaData, config))), "utf8");
}
const stressQr = await QRCode.toString(`https://www.terasuniversal.com.my/verify/${stressData.certificate_number}`, { type: "svg", margin: 1, color: { dark: "#0b1f3a", light: "#ffffff" } });
const qaStressData = { ...stressData, qr_svg: stressQr };
writeFileSync(resolve(out, "long-content-stress-page1.html"), shell(rewriteAssets(renderCertificateFront(qaStressData, stressConfig))), "utf8");
writeFileSync(resolve(out, "long-content-stress-page2.html"), shell(rewriteAssets(renderCertificateBack(qaStressData, stressConfig))), "utf8");
writeFileSync(resolve(out, "long-content-stress.html"), shell(rewriteAssets(renderCertificateDocument(qaStressData, stressConfig))), "utf8");
const intermediateData = base;
const intermediateConfig = { ...common, design_variant: "standard_scaffold_certificate", watermark_level: "intermediate" };
writeFileSync(resolve(out, "grayscale-intermediate-page1.html"), shell(rewriteAssets(renderCertificateFront(intermediateData, intermediateConfig)), true), "utf8");
writeFileSync(resolve(out, "grayscale-intermediate-page2.html"), shell(rewriteAssets(renderCertificateBack(intermediateData, intermediateConfig)), true), "utf8");
console.log(`generated ${familySpecs.length} family fixtures plus stress and grayscale fixtures in ${out}`);
