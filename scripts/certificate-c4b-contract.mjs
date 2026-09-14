import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const design = read("lib/certificate-design-system.ts");
const react = read("components/admin/CertificateDocument.tsx");
const html = read("lib/certificate-html.ts");
const professionalReact = read("components/admin/ProfessionalScaffoldCertificateDocument.tsx");
const professionalHtml = read("lib/professional-scaffold-certificate-html.ts");
const dispatch = read("components/admin/CertificateRenderer.tsx");
const company = read("lib/teras-company.ts");
const watermarkAssets = read("lib/certificate-watermark-assets.ts");
const watermarkFiles = [
  "public/certificates/watermarks/erector-basic.svg",
  "public/certificates/watermarks/erector-intermediate.svg",
  "public/certificates/watermarks/erector-advanced.svg",
  "public/certificates/watermarks/inspector-basic.svg",
  "public/certificates/watermarks/inspector-intermediate.svg",
  "public/certificates/watermarks/inspector-advanced.svg",
  "public/certificates/watermarks/working-at-height.svg",
  "public/certificates/watermarks/professional-scaffold-programme.svg",
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
assert.match(watermarkAssets, /page2Opacity: 0\.040/);
assert.match(watermarkAssets, /return null/);
assert.equal(watermarkFiles.length, 8);
for (const svg of watermarkFiles) {
  assert.match(svg, /<svg[^>]+viewBox="0 0 800 560"/);
  assert.doesNotMatch(svg, /<text\b/i);
}
for (const family of ["PROFESSIONAL SCAFFOLD ERECTION SKILLS PROGRAMME", "WORKING AT HEIGHT", "SCAFFOLDING INSPECTOR", "SCAFFOLDING ERECTOR"]) {
  assert.match(design, new RegExp(family.replaceAll(" ", "\\s+")));
}

for (const source of [react, html, professionalReact, professionalHtml]) {
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
assert.match(react, /translate\(-30px, -26px\)/);
assert.match(html, /translate\(-30px,-26px\)/);
assert.equal((react.match(/<TaglineFooter navy=/g) || []).length, 2, "React must render the official tagline once on each generic page");
assert.equal((html.match(/\$\{taglineFooter\(navy, gold\)\}/g) || []).length, 2, "HTML must render the official tagline once on each generic page");
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
assert.match(react, /opacity: corner \? asset\.page2Opacity : asset\.primaryOpacity/);
assert.match(html, /opacity:\$\{opacity\}/);
assert.doesNotMatch(react, /CERTIFICATE TYPE FROM TEMPLATE/);
assert.doesNotMatch(html, /CERTIFICATE TYPE FROM TEMPLATE/);
assert.doesNotMatch(professionalReact, /CERTIFICATE TYPE FROM TEMPLATE/);
assert.doesNotMatch(professionalHtml, /CERTIFICATE TYPE FROM TEMPLATE/);
assert.doesNotMatch(react, /019-519 3834|www\.terasuniversal\.com\.my|admin@terasuniversal\.com\.my/);
assert.doesNotMatch(html, /019-519 3834|www\.terasuniversal\.com\.my|admin@terasuniversal\.com\.my/);

assert.doesNotMatch(dispatch, /ProfessionalScaffoldCertificateDocument/);
assert.match(dispatch, /return <CertificateDocument data=\{data\} config=\{config\} \/>/);
assert.match(dispatch, /return <CertificateBackPage data=\{data\} config=\{config\} \/>/);

// C4B visual-only guard: the active diff must not broaden into C2/C3/database paths.
const changed = process.env.C4_CHANGED_FILES || "components/admin/CertificateDocument.tsx components/admin/CertificateRenderer.tsx lib/certificate-design-system.ts lib/certificate-html.ts scripts/certificate-c4b-contract.mjs package.json";
for (const file of changed.split(/\s+/).filter(Boolean)) {
  assert.ok(!/(supabase|certificate-skills|actions\.ts|rpc|migration)/i.test(file), `forbidden C4B scope: ${file}`);
}

console.log("C4B Premium Hybrid visual contract passed.");
console.log("- shared design tokens and family labels: PASS");
console.log("- A4 safe margins / print QR / watermark limits: PASS");
console.log("- Page 1 hierarchy and long-content wrapping hooks: PASS");
console.log("- Page 2 skills record structure: PASS");
console.log("- Professional renderer convergence: PASS");
console.log("- C2/C3/database scope guard: PASS");
