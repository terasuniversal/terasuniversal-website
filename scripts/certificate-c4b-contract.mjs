import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const { resolveCertificateWatermarkAsset } = await import("../lib/certificate-watermark-assets.ts");
const { GOLDEN_REFERENCE_OWNER_TITLES, isGoldenReferenceFamily } = await import("../lib/certificate-design-system.ts");
const { standardScaffoldProgrammes } = await import("../lib/standard-scaffold-programmes.ts");
const { workingAtHeightProgrammes } = await import("../lib/working-at-height-programme.ts");
const design = read("lib/certificate-design-system.ts");
const react = read("components/admin/CertificateDocument.tsx");
const html = read("lib/certificate-html.ts");
const dispatch = read("components/admin/CertificateRenderer.tsx");
const c6PrintQa = read("scripts/c6-print-pdf-qa-source.mjs");
const company = read("lib/teras-company.ts");
const watermarkAssets = read("lib/certificate-watermark-assets.ts");
const programmes = read("lib/standard-scaffold-programmes.ts");
const workingAtHeight = read("lib/working-at-height-programme.ts");
const certData = read("app/admin/(protected)/certificates/certData.ts");
const contractSource = read("scripts/certificate-c4b-contract.mjs");

function bodyTextSplitSource(source) {
  const start = source.indexOf("// C4 BODY TEXT SPLIT START");
  const end = source.indexOf("// C4 BODY TEXT SPLIT END");
  assert.ok(start >= 0 && end > start, "renderer must provide the shared body-text continuation policy");
  return source.slice(start, end).replace(/^export\s+/gm, "").replace(/\r\n/g, "\n").trim();
}

const reactBodyTextSplit = bodyTextSplitSource(react);
const htmlBodyTextSplit = bodyTextSplitSource(html);
assert.equal(reactBodyTextSplit, htmlBodyTextSplit, "React and HTML must split body text identically");
const executableBodyTextSplit = reactBodyTextSplit.replace(/:\s*(?:string(?:\s*\|\s*null)?|number)(?=[,\s)=])/g, "");
const splitCertificateBodyText = runInNewContext(`${executableBodyTextSplit}\nsplitCertificateBodyText`);
const longBodyText = "QA notice " + "preserved words ".repeat(220);
const splitBodyText = splitCertificateBodyText(longBodyText);
assert.ok(splitBodyText.pageOneText.length <= 360, "Page 1 body text must stay within its safe budget");
assert.ok(splitBodyText.continuationPages.length > 0, "overflow body text must continue after Page 2");
assert.equal(`${splitBodyText.pageOneText}${splitBodyText.continuationPages.join("")}`, longBodyText, "no body text may be dropped or rewritten");
assert.ok(splitBodyText.continuationPages.every((page) => page.length <= 3000), "each continuation must fit one A4 page");
const shortBodyText = splitCertificateBodyText("Short optional notice.");
assert.equal(shortBodyText.pageOneText, "Short optional notice.");
assert.equal(shortBodyText.continuationPages.length, 0);
const nullBodyText = splitCertificateBodyText(null);
assert.equal(nullBodyText.pageOneText, "");
assert.equal(nullBodyText.continuationPages.length, 0, "null body_text must not make an empty continuation page");
const trailingWhitespaceBodyText = `${"x".repeat(360)} `;
const trailingWhitespaceSplit = splitCertificateBodyText(trailingWhitespaceBodyText);
assert.equal(trailingWhitespaceSplit.continuationPages.length, 0, "trailing whitespace must not create a blank appendix page");
assert.equal(trailingWhitespaceSplit.pageOneText, trailingWhitespaceBodyText, "trailing whitespace remains associated with its visible text");
const watermarkFiles = [
  "public/certificates/watermarks/scaffolding-technical.svg",
  "public/certificates/watermarks/working-at-height.svg",
  "public/certificates/watermarks/confined-space.svg",
  "public/certificates/watermarks/lifting-rigging.svg",
  "public/certificates/watermarks/boiler.svg",
  "public/certificates/watermarks/mechanical.svg",
  "public/certificates/watermarks/electrical.svg",
  "public/certificates/watermarks/fire-safety.svg",
  "public/certificates/watermarks/general-industrial.svg",
].map(read);
const phase2WatermarkSources = [
  "public/certificates/watermarks/mechanical.svg",
  "public/certificates/watermarks/electrical.svg",
  "public/certificates/watermarks/fire-safety.svg",
  "public/certificates/watermarks/general-industrial.svg",
].map(read);

assert.match(design, /A4|widthPx: 794/);
assert.match(design, /heightPx: 1123/);
assert.match(design, /safeMarginPx: 57/);
assert.match(design, /borderInsetPx: 13/);
assert.match(design, /participantNamePx: 40/);
assert.match(design, /minPrintMm: 28/);
assert.match(design, /maxPrintMm: 30/);
assert.match(design, /primaryOpacity: 0\.052/);
assert.match(design, /secondaryOpacity: 0\.024/);
assert.match(design, /backOpacity: 0\.040/);
assert.match(company, /TERAS_COMPANY_TAGLINE\s*=\s*"BUILDING COMPETENCE\. CREATING OPPORTUNITIES\."/);
assert.match(watermarkAssets, /resolveCertificateWatermarkAsset/);
assert.match(watermarkAssets, /primaryOpacity: 0\.052/);
assert.match(watermarkAssets, /page2Opacity(?:\s*=\s*|:\s*)0\.040/);
assert.match(watermarkAssets, /: asset\("general-safety", "general-industrial\.svg"\)/);
assert.doesNotMatch(react, /config\.background_url/);
assert.doesNotMatch(html, /config\.background_url/);
assert.match(react, /const showDurationRibbon = Boolean\(duration\)/);
assert.match(html, /const showDurationRibbon = Boolean\(duration\)/);
assert.match(dispatch, /CertificateBodyTextContinuationPage/);
assert.match(html, /renderCertificateBodyTextContinuationPage/);
assert.match(c6PrintQa, /components\/admin\/CertificateRenderer\.tsx/);
assert.match(c6PrintQa, /renderReactComponent\(CertificateFront/);
assert.match(c6PrintQa, /renderReactComponent\(CertificateBack/);
assert.doesNotMatch(c6PrintQa, /renderProfessionalScaffoldCertificate(?:Front|Back)/);
assert.equal(watermarkFiles.length, 9);
for (const svg of watermarkFiles) {
  assert.match(svg, /<svg[^>]+viewBox="0 0 800 560"/);
  assert.doesNotMatch(svg, /<text\b/i);
}
const familyCases = [
  ["standard_scaffold_certificate", "scaffolding", "scaffolding-technical.svg", { watermark_level: "basic" }],
  ["professional_scaffold_erection_skills", "scaffolding", "scaffolding-technical.svg", { watermark_level: "advanced" }],
  ["standard_scaffold_certificate", "scaffolding", "scaffolding-technical.svg", { inspector_watermark_level: "intermediate" }],
  ["scaffolding", "scaffolding", "scaffolding-technical.svg", {}],
  ["scaffolding_certificate", "scaffolding", "scaffolding-technical.svg", {}],
  ["working_at_height_certificate", "working-at-height", "working-at-height.svg", {}],
  ["working_at_height", "working-at-height", "working-at-height.svg", {}],
  ["working-at-height", "working-at-height", "working-at-height.svg", {}],
  ["confined_space_certificate", "confined-space", "confined-space.svg", {}],
  ["confined_space", "confined-space", "confined-space.svg", {}],
  ["lifting_rigging_certificate", "lifting-rigging", "lifting-rigging.svg", {}],
  ["lifting_rigging", "lifting-rigging", "lifting-rigging.svg", {}],
  ["boiler_certificate", "boiler", "boiler.svg", {}],
  ["boiler", "boiler", "boiler.svg", {}],
  ["mechanical_certificate", "mechanical", "mechanical.svg", {}],
  ["mechanical", "mechanical", "mechanical.svg", {}],
  ["electrical_certificate", "electrical", "electrical.svg", {}],
  ["electrical", "electrical", "electrical.svg", {}],
  ["fire_safety_certificate", "fire-safety", "fire-safety.svg", {}],
  ["fire_safety", "fire-safety", "fire-safety.svg", {}],
  ["general_safety", "general-safety", "general-industrial.svg", {}],
  ["general_safety_certificate", "general-safety", "general-industrial.svg", {}],
  ["unmapped_template", "general-safety", "general-industrial.svg", {}],
];
for (const [design_variant, family, filename, extra] of familyCases) {
  const resolved = resolveCertificateWatermarkAsset({ design_variant, ...extra });
  assert.equal(resolved?.family, family, `${design_variant} must use its course-family line-art`);
  assert.equal(resolved?.level, undefined, "legacy level selectors must not imply level-specific artwork");
  assert.ok(resolved?.src.endsWith(filename), `${design_variant} must resolve to ${filename}`);
  assert.ok(resolved.primaryOpacity <= 0.052, `${design_variant} watermark must remain print-subtle`);
  const reducedPage2Families = new Set(["scaffolding", "working-at-height", "confined-space", "lifting-rigging", "boiler"]);
  const reducedPage2Variants = new Set(["mechanical", "mechanical_certificate", "electrical", "electrical_certificate", "fire_safety", "fire_safety_certificate", "general_safety", "general_safety_certificate"]);
  const expectedPage2Opacity = reducedPage2Families.has(family) || reducedPage2Variants.has(design_variant) ? 0.024 : 0.040;
  assert.equal(resolved.page2Opacity, expectedPage2Opacity, `${family} Page 2 opacity must match its approved C4 family treatment`);
  assert.ok(resolved.page2Opacity < resolved.primaryOpacity, `${family} Page 2 watermark must remain lighter than Page 1`);
}
for (const [index, svg] of phase2WatermarkSources.entries()) {
  const colors = [...new Set([...svg.matchAll(/#[0-9a-f]{6}\b/gi)].map(([color]) => color.toLowerCase()))];
  assert.deepEqual(colors, ["#0b1f3a"], `Phase 2 watermark ${index + 1} must use only the approved single ink color`);
  assert.match(svg, /fill="none"/, `Phase 2 watermark ${index + 1} must remain unfilled line-art`);
  assert.doesNotMatch(svg, /<(?:script|image|foreignObject)\b|\son[a-z]+\s*=/i, `Phase 2 watermark ${index + 1} must not include active or external content`);
}
const goldenReferenceCases = [
  ["standard_scaffold_certificate", "scaffolding_erector", GOLDEN_REFERENCE_OWNER_TITLES.scaffoldingErector, "scaffolding-technical.svg"],
  ["standard_scaffold_certificate", "scaffold_inspector", GOLDEN_REFERENCE_OWNER_TITLES.scaffoldingInspector, "scaffolding-technical.svg"],
  ["professional_scaffold_erection_skills", "professional_scaffold_erection_skills", GOLDEN_REFERENCE_OWNER_TITLES.professionalScaffold, "scaffolding-technical.svg"],
  ["working_at_height_certificate", "working_at_height", GOLDEN_REFERENCE_OWNER_TITLES.workingAtHeight, "working-at-height.svg"],
];
for (const [design_variant, golden_reference_family, certificate_title, filename] of goldenReferenceCases) {
  const config = { design_variant, golden_reference_family, certificate_title };
  assert.equal(isGoldenReferenceFamily(config), true, `${golden_reference_family} must use the Golden Reference`);
  assert.ok(resolveCertificateWatermarkAsset(config).src.endsWith(filename), `${golden_reference_family} line-art must use ${filename}`);
}
assert.equal(isGoldenReferenceFamily({ design_variant: "standard_scaffold_certificate", golden_reference_family: "scaffold_inspector", certificate_title: GOLDEN_REFERENCE_OWNER_TITLES.scaffoldingErector }), false, "family metadata cannot authorize a mismatched family title");
assert.equal(isGoldenReferenceFamily({ design_variant: "standard_scaffold_certificate", certificate_title: GOLDEN_REFERENCE_OWNER_TITLES.scaffoldingErector }), false, "unresolved template titles cannot opt an unverified course into Wave 1");
for (const design_variant of [
  "confined_space_certificate",
  "lifting_rigging_certificate",
  "boiler_certificate",
  "mechanical_certificate",
  "electrical_certificate",
  "fire_safety_certificate",
  "general_safety_certificate",
]) {
  assert.equal(isGoldenReferenceFamily({ design_variant, certificate_title: "WAVE 2 ONLY" }), false, `${design_variant} must remain outside Wave 1`);
}
const familyLineArt = [
  "public/certificates/watermarks/scaffolding-technical.svg",
  "public/certificates/watermarks/working-at-height.svg",
  "public/certificates/watermarks/confined-space.svg",
  "public/certificates/watermarks/lifting-rigging.svg",
  "public/certificates/watermarks/boiler.svg",
  "public/certificates/watermarks/mechanical.svg",
  "public/certificates/watermarks/electrical.svg",
  "public/certificates/watermarks/fire-safety.svg",
  "public/certificates/watermarks/general-industrial.svg",
].map(read);
assert.equal(familyLineArt.length, 9, "course-family art should remain reusable rather than course-specific");
for (const svg of familyLineArt) {
  assert.match(svg, /<g[^>]+stroke="#0b1f3a"/i, "family art must use engineering line-work");
  assert.doesNotMatch(svg, /<text\b|<filter\b|<image\b/i);
}
for (const family of ["PROFESSIONAL SCAFFOLD ERECTION SKILLS PROGRAMME", "WORKING AT HEIGHT", "SCAFFOLDING INSPECTOR", "SCAFFOLDING ERECTOR"]) {
  assert.match(design, new RegExp(family.replaceAll(" ", "\\s+")));
}

for (const source of [react, html]) {
  assert.doesNotMatch(source, /202201038223|1477529-X/);
  assert.match(source, /201201003207|TERAS_COMPANY_REGISTRATION/);
}
for (const source of [react, html]) {
  assert.match(source, /certificate-design-system/);
  assert.match(source, /PARTICIPANT SKILLS RECORD/);
  assert.match(source, /CERTIFICATE_DESIGN\.qr\.sizePx/);
  assert.match(source, /overflowWrap: "anywhere"|overflow-wrap:anywhere/);
  assert.match(source, /Theory Session/);
  assert.match(source, /Practical Training/);
  assert.match(source, /Safety Awareness/);
  assert.match(source, /Practical Assessment/);
  assert.match(source, /Attendance Requirement/);
}
assert.match(react, /data\.ic_passport/);
assert.match(html, /data\.ic_passport/);
assert.match(react, /data\.course_name/);
assert.match(html, /data\.course_name/);
assert.match(react, /translate\(-56px, -26px\)/);
assert.match(html, /translate\(-56px,-26px\)/);
assert.match(react, /size=\{CERTIFICATE_DESIGN\.qr\.sizePx - 34\} caption safeZone \/>/);
assert.match(html, /CERTIFICATE_DESIGN\.qr\.sizePx - 34, true, true\)/);
assert.equal((react.match(/<TaglineFooter navy=/g) || []).length, 4, "React must render the official tagline on both Page 1 paths, Page 2 and any continuation");
assert.equal((html.match(/\$\{taglineFooter\(navy, gold\)\}/g) || []).length, 4, "HTML must render the official tagline on both Page 1 paths, Page 2 and any continuation");
assert.match(react, /width: 228, height: 106/);
assert.match(html, /width:228px;height:106px/);
assert.match(react, /zIndex: 2, display: "flex"/);
assert.match(react, /width: 228, height: 106, marginLeft: 52/);
assert.match(html, /position:relative;z-index:2;display:flex/);
assert.match(html, /width:228px;height:106px;margin-left:52px/);
assert.match(react, /width: 900, height: 720/);
assert.match(html, /width:900px;height:720px/);
assert.match(react, /resolveCertificateWatermarkAsset/);
assert.match(html, /resolveCertificateWatermarkAsset/);
assert.match(react, /opacity: goldenReferencePageOne \? 0\.048 : corner \? asset\.page2Opacity : asset\.primaryOpacity/);
assert.match(html, /opacity:\$\{opacity\}/);
assert.doesNotMatch(react, /CERTIFICATE TYPE FROM TEMPLATE/);
assert.doesNotMatch(html, /CERTIFICATE TYPE FROM TEMPLATE/);
assert.doesNotMatch(react, /019-519 3834|www\.terasuniversal\.com\.my|admin@terasuniversal\.com\.my/);
assert.doesNotMatch(html, /019-519 3834|www\.terasuniversal\.com\.my|admin@terasuniversal\.com\.my/);

assert.doesNotMatch(dispatch, /ProfessionalScaffoldCertificateDocument|ProfessionalScaffoldCertificateBackPage/);
assert.match(dispatch, /return <CertificateDocument data=\{data\} config=\{config\} \/>/);
const reactBackDispatch = dispatch.slice(dispatch.indexOf("export function CertificateBack"));
assert.match(reactBackDispatch, /<CertificateBackPage data=\{data\} config=\{config\} \/>/);
assert.match(reactBackDispatch, /<CertificateBodyTextContinuationPages data=\{data\} config=\{config\} \/>/);
assert.ok(reactBackDispatch.indexOf("CertificateBackPage") < reactBackDispatch.indexOf("CertificateBodyTextContinuationPages"), "continuation must follow Page 2");
assert.doesNotMatch(html, /renderProfessionalScaffoldCertificateDocument|professional-scaffold-certificate-html/);
assert.doesNotMatch(html, /design_variant === "professional_scaffold_erection_skills"\)\s*\{\s*return renderProfessional/);
const reactFront = react.slice(react.indexOf("export function CertificateDocument"), react.indexOf("export function CertificateBodyTextContinuationPages"));
const htmlFront = html.slice(html.indexOf("export function renderCertificateFront"), html.indexOf("export function renderCertificateBack"));
assert.equal((reactFront.match(/splitCertificateBodyText\(config\.body_text\)/g) || []).length, 1, "React Page 1 must compute the body split once");
assert.equal((htmlFront.match(/splitCertificateBodyText\(config\.body_text\)/g) || []).length, 1, "HTML Page 1 must compute the body split once");
assert.doesNotMatch(reactFront, /QrBlock|qr_svg|QR VERIFICATION/);
assert.doesNotMatch(htmlFront, /qrBlock|qr_svg|QR VERIFICATION/);
assert.match(react.slice(react.indexOf("export function CertificateBackPage")), /QrBlock/);
assert.match(html.slice(html.indexOf("export function renderCertificateBack")), /qrBlock/);
const reactContinuation = react.slice(react.indexOf("export function CertificateBodyTextContinuationPages"), react.indexOf("export function CertificateBackPage"));
const htmlContinuation = html.slice(html.indexOf("function renderCertificateBodyTextContinuationPage"), html.indexOf("export function renderCertificateBody"));
assert.doesNotMatch(reactContinuation, /QrBlock|qr_svg/);
assert.doesNotMatch(htmlContinuation, /qrBlock|qr_svg/);
assert.match(react, /STAMP_ASSET_PENDING/);
for (const marker of ["CONTINUED — PAGE", "Certificate No.", "Certificate Information", "PROGRAMME DETAILS"]) {
  assert.ok(reactContinuation.includes(marker) && htmlContinuation.includes(marker), `both continuation renderers must share ${marker}`);
}
assert.match(reactContinuation, /pageIndex \+ \(config\.show_back_page === false \? 2 : 3\)/);
assert.match(htmlContinuation, /logicalPageNumber = pageIndex \+ firstContinuationPage/);
assert.match(reactContinuation, /pageBreakAfter: pageIndex < continuationPages\.length - 1 \? "always"/);
assert.match(htmlContinuation, /page-break-after:always/);
assert.doesNotMatch(reactContinuation, /pageBreakBefore|breakBefore/);
assert.doesNotMatch(htmlContinuation, /page-break-before|break-before/);
assert.match(react.slice(react.indexOf("export function CertificateDocument"), react.indexOf("export function CertificateBackPage")), /pageBreakAfter:/);
assert.match(react.slice(react.indexOf("export function CertificateBackPage")), /pageBreakAfter:/);
const htmlPrintBody = html.slice(html.indexOf("export function renderCertificateBody"), html.indexOf("export function renderCertificateDocument"));
assert.match(htmlPrintBody, /page-break-after:always/, "HTML page transitions must use a consistent break-after strategy");
assert.match(htmlPrintBody, /\$\{back\}\$\{continuation\}/, "HTML continuation must follow the unchanged Page 2");

// C4 Wave 1: exactly six verified Scaffold programmes plus Professional
// Scaffold and Working at Height use the approved Golden Reference Page 1.
// Owner-policy titles are family-specific; Page 2 remains on its prior path.
const waveOneScaffoldProgrammes = [
  ["basic_erection", "SCAFFOLDING TRAINING CERTIFICATE"],
  ["intermediate_erection", "SCAFFOLDING TRAINING CERTIFICATE"],
  ["advanced_erection", "SCAFFOLDING TRAINING CERTIFICATE"],
  ["basic_inspection", "SCAFFOLDING INSPECTION CERTIFICATE"],
  ["intermediate_inspection", "SCAFFOLDING INSPECTION CERTIFICATE"],
  ["advanced_inspection", "SCAFFOLDING INSPECTION CERTIFICATE"],
];
for (const [key, title] of waveOneScaffoldProgrammes) {
  const start = programmes.indexOf(`  ${key}: {`);
  const next = programmes.indexOf("\n  },", start) + 5;
  const entry = programmes.slice(start, next);
  assert.ok(start >= 0 && next > start, `${key} must remain a bounded verified programme mapping`);
  assert.match(entry, new RegExp(`certificate_title:\\s*"${title}"`), `${key} must carry its owner-locked family title`);
  assert.match(entry, /content_status:\s*"verified"/, `${key} may propagate only verified programme data`);
  const programme = standardScaffoldProgrammes[key];
  assert.equal(programme?.content_status, "verified", `${key} runtime data must be verified`);
  assert.equal(programme?.certificate_title, title, `${key} runtime title must match owner policy`);
  assert.ok(programme?.course_id, `${key} must resolve to a verified course id`);
}
assert.equal((programmes.match(/\s+certificate_title:\s*"SCAFFOLDING TRAINING CERTIFICATE"/g) || []).length, 3);
assert.equal((programmes.match(/\s+certificate_title:\s*"SCAFFOLDING INSPECTION CERTIFICATE"/g) || []).length, 3);
const awarenessProgramme = programmes.slice(programmes.indexOf("  scaffold_awareness:"));
assert.doesNotMatch(awarenessProgramme, /certificate_title:/, "draft Scaffold Awareness must not enter Wave 1");
assert.match(workingAtHeight, /certificate_title:\s*"WORKING AT HEIGHT TRAINING CERTIFICATE"/);
assert.equal(workingAtHeightProgrammes.working_at_height?.certificate_title, GOLDEN_REFERENCE_OWNER_TITLES.workingAtHeight);
assert.equal(workingAtHeightProgrammes.working_at_height?.content_status, "verified");
assert.ok(workingAtHeightProgrammes.working_at_height?.course_id);
assert.match(design, /scaffoldingErector:\s*"SCAFFOLDING TRAINING CERTIFICATE"/);
assert.match(design, /scaffoldingInspector:\s*"SCAFFOLDING INSPECTION CERTIFICATE"/);
assert.match(design, /workingAtHeight:\s*"WORKING AT HEIGHT TRAINING CERTIFICATE"/);
assert.match(design, /professionalScaffold:\s*"PROFESSIONAL SCAFFOLD ERECTION SKILLS PROGRAMME"/);
assert.match(certData, /golden_reference_family/);
assert.match(certData, /GOLDEN_REFERENCE_OWNER_TITLES/);
assert.match(certData, /config\.show_back_page = true/);
assert.match(certData, /config\.show_qr = true/);
assert.match(certData, /findStandardScaffoldProgrammeByCourseId\(c\.course_id\)/);
assert.match(certData, /programme\?\.category === "Scaffold Inspection"/);
assert.match(certData, /findWorkingAtHeightProgrammeByCourseId\(c\.course_id\)/);
assert.match(certData, /professional_scaffold_erection_skills/);
assert.doesNotMatch([certData, programmes, workingAtHeight].join("\n"), /W1-OWNER-PREVIEW-2026|OWNER REVIEW PREVIEW|PREVIEW-ONLY-C4/);
for (const [source, start, end] of [
  [react, "function GoldenReferencePageOne", "export function CertificateDocument"],
  [html, "function renderGoldenReferencePageOne", "export function renderCertificateFront"],
]) {
  const golden = source.slice(source.indexOf(start), source.indexOf(end));
  assert.ok(golden.startsWith(start), `${start} golden renderer must exist before the standard renderer`);
  assert.match(golden, /config\.certificate_title/);
  assert.match(golden, /Certificate No\./i);
  assert.match(golden, /AUTHORIZED DIRECTOR|AUTHORISED DIRECTOR/);
  assert.match(golden, /STAMP_ASSET_PENDING/);
  assert.match(golden, /data\.training_date|dateRange/);
  assert.match(golden, /data\.venue/);
  assert.match(golden, /TRAINING DURATION/);
  assert.match(golden, /DIRECTOR_SIGNATURE_ASSET/);
  assert.doesNotMatch(golden, /config\.signature_url|config\.signature_name/, "Wave 1 authority must not inherit trainer/manager snapshot signature fields");
  assert.doesNotMatch(golden, /MetaTile|metaTile|QrBlock|qrBlock|qr_svg|QR VERIFICATION/);
}
assert.match(react, /isGoldenReferenceFamily/);
assert.match(html, /isGoldenReferenceFamily/);
assert.match(react, /golden_reference_family/);

// Round 2 visual treatment is inherited by Wave 1 without changing Page 2.
const reactGoldenPageOne = react.slice(react.indexOf("function GoldenReferencePageOne"), react.indexOf("export function CertificateDocument"));
const htmlGoldenPageOne = html.slice(html.indexOf("function renderGoldenReferencePageOne"), html.indexOf("export function renderCertificateFront"));
assert.match(reactGoldenPageOne, /<CertificateWatermark config=\{config\} goldenReferencePageOne \/>/);
assert.match(htmlGoldenPageOne, /\$\{certificateWatermark\(config, false, true\)\}/);
assert.match(react, /goldenReferencePageOne = false/);
assert.match(react, /width: 800, height: 560, style: \{ top: 270, right: -24 \}/);
assert.match(html, /top:270px;right:-24px;width:800px;height:560px;/);
assert.match(react, /goldenReferencePageOne \? 0\.048 : corner \? asset\.page2Opacity : asset\.primaryOpacity/);
assert.match(html, /goldenReferencePageOne \? 0\.048 : corner \? asset\.page2Opacity : asset\.primaryOpacity/);
assert.match(reactGoldenPageOne, /color: "#596273"/);
assert.match(htmlGoldenPageOne, /color:#596273/);
assert.match(reactGoldenPageOne, /maxHeight: 62/);
assert.match(htmlGoldenPageOne, /max-height:62px/);
assert.match(reactGoldenPageOne, /width: 108, height: 108/);
assert.match(htmlGoldenPageOne, /width:108px;height:108px/);
assert.match(reactGoldenPageOne, /Certificate No\./);
assert.match(htmlGoldenPageOne, /Certificate No\./);
assert.doesNotMatch(react.slice(react.indexOf("export function CertificateBackPage")), /goldenReferencePageOne/);
assert.doesNotMatch(html.slice(html.indexOf("export function renderCertificateBack")), /goldenReferencePageOne/);
const htmlSkillsRecordStart = html.indexOf("const skillsTable =");
const htmlSkillsRecordEnd = html.indexOf("const noticeHtml", htmlSkillsRecordStart);
const htmlSkillsRecord = html.slice(htmlSkillsRecordStart, htmlSkillsRecordEnd);
assert.ok(htmlSkillsRecordStart >= 0 && htmlSkillsRecordEnd > htmlSkillsRecordStart, "HTML Participant Skills Record section must be defined");
assert.match(htmlSkillsRecord, /sectionHead\(\s*"doc",\s*"PARTICIPANT SKILLS RECORD"\s*\)/, "HTML Participant Skills Record must use the same direct heading structure as React");
assert.doesNotMatch(htmlSkillsRecord, /\bsection\s*\(/, "HTML Participant Skills Record must not inherit the generic 16px section margin");

// C4 bounded-change guard: compare committed branch changes and current worktree changes to the upstream base.
const mergeBaseSourceIndex = contractSource.lastIndexOf("const mergeBase = execFileSync(");
const changedSourceIndex = contractSource.lastIndexOf("const changed = [");
const watermarkAllowlistIndex = contractSource.lastIndexOf("const allowedWatermarkAssets = new Set([");
assert.ok(mergeBaseSourceIndex >= 0 && changedSourceIndex > mergeBaseSourceIndex, "scope guard must account for committed changes on the feature branch");
assert.ok(watermarkAllowlistIndex > changedSourceIndex, "watermark changes must be limited to the approved C4 art assets");
const gitDiscoverySource = contractSource.slice(mergeBaseSourceIndex, changedSourceIndex);
assert.match(gitDiscoverySource, /"merge-base"/);
const pathGuardSource = contractSource.slice(watermarkAllowlistIndex, contractSource.indexOf("for (const file of new Set(changed))", watermarkAllowlistIndex));
assert.match(pathGuardSource, /public\/certificates\/watermarks\/general-industrial\.svg/);
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const mergeBase = execFileSync("git", ["-C", repositoryRoot, "merge-base", "HEAD", "origin/main"], { encoding: "utf8" }).trim();
const changed = [
  ...execFileSync("git", ["-C", repositoryRoot, "diff", "--name-only", mergeBase, "HEAD"], { encoding: "utf8" }).trim().split(String.fromCharCode(10)),
  ...execFileSync("git", ["-C", repositoryRoot, "diff", "--name-only", "HEAD"], { encoding: "utf8" }).trim().split(String.fromCharCode(10)),
  ...execFileSync("git", ["-C", repositoryRoot, "ls-files", "--others", "--exclude-standard"], { encoding: "utf8" }).trim().split(String.fromCharCode(10)),
].map((file) => file.trim()).filter(Boolean);

const allowed = new Set([
  ".ai/PROJECT_STATUS.md",
  "app/admin/(protected)/certificates/actions.ts",
  "app/admin/(protected)/certificates/certData.ts",
  "components/admin/CertificateDocument.tsx",
  "components/admin/CertificateRenderer.tsx",
  "lib/certificate-html.ts",
  "lib/certificate-page2-snapshot.ts",
  "lib/certificate-design-system.ts",
  "lib/certificate-watermark-assets.ts",
  "lib/standard-scaffold-programmes.ts",
  "lib/working-at-height-programme.ts",
  "package.json",
  "scripts/certificate-c4b-contract.mjs",
  "scripts/certificate-page2-snapshot-fixtures.mjs",
  "scripts/c6-print-pdf-qa-source.mjs",
  "scripts/certificate-c5b1-verification-control-contract.mjs",
  "scripts/certificate-i3a-lifecycle-runtime.mjs",
  "scripts/certificate-i3a-source-contract.mjs",
  "scripts/certificate-i3b-public-rpc-contract.mjs",
  "scripts/certificate-i3c-auth-runtime.mjs",
  "scripts/certificate-i3c-error-sanitization.mjs",
  "supabase/migrations/20260924120000_certificate_c5b1_verification_control.sql",
  "supabase/migrations/20260924130000_certificate_c5b1_import_boolean_cast_fix.sql",
  "supabase/migrations/20260924140000_certificate_c5b1_production_final_state.sql",
  "supabase/migrations/20260924150000_certificate_c5b1_security_drift_hardening.sql",
  "supabase/migrations/20260924160000_certificate_lifecycle_force_rls_hardening.sql",
  "supabase/migrations/20260924170000_certificate_public_rpc_surface.sql",
  "supabase/tests/certificate_legacy_import_anon_invoker_contract.sql",
  "supabase/tests/certificate_verification_control_contract.sql",
  "supabase/tests/certificate_verification_training_period_contract.sql",
  "supabase/tests/certificate_i2_c5_security_contract.sql",
  "supabase/tests/certificate_i2_verifier_snapshot_contract.sql",
  "supabase/tests/certificate_i2_legacy_import_runtime_contract.sql",
  "supabase/tests/certificate_i3a_force_rls_policy_contract.sql",
  "supabase/tests/certificate_i3a_lifecycle_runtime_contract.sql",
  "supabase/tests/certificate_i3c_authorization_runtime.sql",
  "supabase/tests/fixtures/certificate_i3c_auth_compat.sql",
]);
{
  const c4PackageBaseline = "35433961c26c873be20d98918647ad27bbe800cc";
  const baselinePackage = JSON.parse(execFileSync("git", ["-C", repositoryRoot, "show", `${c4PackageBaseline}:package.json`], { encoding: "utf8" }));
  const currentPackage = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const approvedScriptAdditions = {
    "test:certificate-c5b1": "node scripts/certificate-c5b1-verification-control-contract.mjs",
  };
  const assertAllowedPackageScripts = (scripts) => {
    assert.deepEqual(
      scripts,
      { ...baselinePackage.scripts, ...approvedScriptAdditions },
      "package.json script changes exceed the explicit C4/I2 baseline allowlist",
    );
  };
  assertAllowedPackageScripts(currentPackage.scripts);
  assert.throws(
    () => assertAllowedPackageScripts({ ...currentPackage.scripts, "test:unrelated": "node scripts/unrelated.mjs" }),
    /explicit C4\/I2 baseline allowlist/,
    "an unrelated package script mutation must still fail the C4 contract",
  );
  const { scripts: _currentScripts, ...currentPackageRest } = currentPackage;
  const { scripts: _baselineScripts, ...baselinePackageRest } = baselinePackage;
  assert.deepEqual(currentPackageRest, baselinePackageRest, "package.json changes outside test scripts are forbidden");
}
const allowedWatermarkAssets = new Set([
  "public/certificates/watermarks/scaffolding-technical.svg",
  "public/certificates/watermarks/working-at-height.svg",
  "public/certificates/watermarks/confined-space.svg",
  "public/certificates/watermarks/lifting-rigging.svg",
  "public/certificates/watermarks/boiler.svg",
  "public/certificates/watermarks/mechanical.svg",
  "public/certificates/watermarks/electrical.svg",
  "public/certificates/watermarks/fire-safety.svg",
  "public/certificates/watermarks/general-industrial.svg",
]);
for (const file of new Set(changed)) {
  assert.ok(allowed.has(file) || allowedWatermarkAssets.has(file), `forbidden C4 scope: ${file}`);
}

console.log("C4 Architectural Scaffold visual contract passed.");
console.log("- one master layout and dynamic course-family mapping: PASS");
console.log("- A4 safe margins / print QR / watermark limits: PASS");
console.log("- Page 1 hierarchy and long-content wrapping hooks: PASS");
console.log("- Page 2 skills record structure: PASS");
console.log("- Page 1 QR exclusion / Page 2 QR placement: PASS");
console.log("- C2/C3/database scope guard: PASS");
