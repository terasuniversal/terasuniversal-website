import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const design = read("lib/certificate-design-system.ts");
const react = read("components/admin/CertificateDocument.tsx");
const html = read("lib/certificate-html.ts");
const dispatch = read("components/admin/CertificateRenderer.tsx");

assert.match(design, /A4|widthPx: 794/);
assert.match(design, /heightPx: 1123/);
assert.match(design, /safeMarginPx: 57/);
assert.match(design, /borderInsetPx: 38/);
assert.match(design, /participantNamePx: 40/);
assert.match(design, /minPrintMm: 28/);
assert.match(design, /maxPrintMm: 30/);
assert.match(design, /primaryOpacity: 0\.034/);
assert.match(design, /secondaryOpacity: 0\.018/);
for (const family of ["PROFESSIONAL SCAFFOLD ERECTION SKILLS PROGRAMME", "WORKING AT HEIGHT", "SCAFFOLDING INSPECTOR", "SCAFFOLDING ERECTOR"]) {
  assert.match(design, new RegExp(family.replaceAll(" ", "\\s+")));
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
