// PDF two-page A4 contract for the C4 Golden Reference snapshot render,
// across all three Erector levels (scripts/c4-snapshot-preview.mjs must
// have generated the PDFs first). Verification/contact grid is fully
// populated (certificate number, phone, website, email, issuing branch
// address) -- the real worst-case layout, not a simplified fixture.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const root = resolve(import.meta.dirname, "..");
const output = resolve(process.env.PREVIEW_OUTPUT_DIR || resolve(root, "certificate-previews"));
const normalize = (value) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");

const levels = [
  { file: "erector-basic", title: "SCAFFOLDING TRAINING CERTIFICATE", programme: "TERAS BASIC SCAFFOLD ERECTION PROGRAMME", certNumber: "TU-CERT-2026-ERECTOR-BASIC-000123" },
  { file: "erector-intermediate", title: "SCAFFOLDING TRAINING CERTIFICATE", programme: "TERAS INTERMEDIATE SCAFFOLD ERECTION PROGRAMME", certNumber: "TU-CERT-2026-INTERMEDIATE-SCAFFOLDING-ERECTOR-000124" },
  { file: "erector-advanced", title: "SCAFFOLDING TRAINING CERTIFICATE", programme: "TERAS ADVANCED SCAFFOLD ERECTION PROGRAMME", certNumber: "TU-CERT-2026-ERECTOR-ADVANCED-000125" },
];

for (const level of levels) {
  const pdf = await getDocument({ url: pathToFileURL(resolve(output, `${level.file}.pdf`)).href }).promise;
  assert.equal(pdf.numPages, 2, `${level.file}: expected exactly two pages`);
  const pages = [];
  for (let index = 1; index <= pdf.numPages; index += 1) {
    const page = await pdf.getPage(index);
    const viewport = page.getViewport({ scale: 1 });
    assert.ok(Math.abs(viewport.width - 595) < 1 && Math.abs(viewport.height - 842) < 1, `${level.file} page ${index}: not A4 portrait`);
    const content = await page.getTextContent();
    const items = content.items.filter((item) => "str" in item && item.str.trim());
    assert.ok(items.length > 5, `${level.file} page ${index}: blank or nearly blank page`);
    const text = items.map((item) => item.str).join(" ");
    pages.push({ text, normalized: normalize(text), items });
  }

  assert.ok(pages[0].normalized.includes(normalize(level.title)), `${level.file} Page 1: Golden Reference certificate_title missing`);
  assert.ok(pages[0].normalized.includes(normalize(level.certNumber)), `${level.file} Page 1: certificate number missing or clipped`);
  assert.ok(pages[0].normalized.includes("SYNTHETICQAPARTICIPANT"), `${level.file} Page 1: participant must be synthetic`);

  assert.ok(pages[1].normalized.includes("QRVERIFICATION"), `${level.file} Page 2: QR heading missing`);
  assert.ok(pages[1].normalized.includes(normalize(level.programme)), `${level.file} Page 2: frozen programme title missing`);
  assert.ok(pages[1].normalized.includes("PARTICIPANTSKILLSRECORD"), `${level.file} Page 2: skills record section missing`);
  for (const area of ["THEORYSESSION", "PRACTICALTRAINING", "SAFETYAWARENESS", "PRACTICALASSESSMENT", "ATTENDANCEREQUIREMENT"]) {
    assert.ok(pages[1].normalized.includes(area), `${level.file} Page 2: skills area ${area} missing from the rendered table`);
  }
  assert.ok(pages[1].normalized.includes("CONTACTNUMBER") && pages[1].normalized.includes("WEBSITE") && pages[1].normalized.includes("EMAIL"), `${level.file} Page 2: contact fields missing`);
  assert.ok(pages[1].normalized.includes("ISSUINGBRANCHADDRESS"), `${level.file} Page 2: Issuing Branch Address label missing`);
  assert.ok(pages[1].normalized.includes(normalize("JALAN TANAH MERAH")) && pages[1].normalized.includes("JITRA"), `${level.file} Page 2: issuer address text missing or clipped`);

  // Footer/address clearance: the address value's text baseline must sit
  // comfortably above the footer tagline's baseline (PDF y-axis increases
  // upward from the page bottom), not merely "present somewhere on the
  // page" -- this is the actual regression check for the overlap this fix
  // addresses, not just text-presence.
  const addressItem = pages[1].items.find((item) => item.str.includes("JITRA"));
  // Letter-spaced CSS text (the footer uses letter-spacing:1.6px) gets
  // extracted by pdf.js with a space inserted between every glyph (e.g.
  // "BUILDING" -> "B U I L D I N G"), so match against the whitespace-
  // stripped form rather than the literal word.
  const footerItem = pages[1].items.find((item) => item.str.replace(/\s+/g, "").toUpperCase().includes("BUILDING"));
  assert.ok(addressItem, `${level.file}: could not locate the address text item for clearance check`);
  assert.ok(footerItem, `${level.file}: could not locate the footer text item for clearance check`);
  const addressBaselineY = addressItem.transform[5];
  const footerBaselineY = footerItem.transform[5];
  assert.ok(addressBaselineY > footerBaselineY + 10, `${level.file}: issuing branch address (y=${addressBaselineY}) does not clear the footer (y=${footerBaselineY}) by a safe margin`);

  console.log(`${level.file}: 2 nonblank A4 pages; title, certificate number, QR, programme content, five-area skills, full contact grid and issuing branch address all verified, with safe footer clearance`);
}
