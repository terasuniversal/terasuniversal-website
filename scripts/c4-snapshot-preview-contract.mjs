// PDF two-page A4 contract for the Phase A Golden Reference snapshot render
// (scripts/c4-snapshot-preview.mjs must have generated the PDF first).
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const root = resolve(import.meta.dirname, "..");
const output = resolve(process.env.PREVIEW_OUTPUT_DIR || resolve(root, "certificate-previews"));
const normalize = (value) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");

const pdf = await getDocument({ url: pathToFileURL(resolve(output, "erector-snapshot.pdf")).href }).promise;
assert.equal(pdf.numPages, 2, "expected exactly two pages");
const pages = [];
for (let index = 1; index <= pdf.numPages; index += 1) {
  const page = await pdf.getPage(index);
  const viewport = page.getViewport({ scale: 1 });
  assert.ok(Math.abs(viewport.width - 595) < 1 && Math.abs(viewport.height - 842) < 1, `page ${index}: not A4 portrait`);
  const content = await page.getTextContent();
  const items = content.items.filter((item) => "str" in item && item.str.trim());
  assert.ok(items.length > 5, `page ${index}: blank or nearly blank page`);
  const text = items.map((item) => item.str).join(" ");
  pages.push({ text, normalized: normalize(text) });
}
assert.ok(pages[0].normalized.includes(normalize("SCAFFOLDING TRAINING CERTIFICATE")), "Page 1: Golden Reference certificate_title missing");
assert.ok(pages[0].normalized.includes(normalize("TU-CERT-2026-ERECTOR-SNAPSHOT-000123")), "Page 1: certificate number missing");
assert.ok(pages[0].normalized.includes("SYNTHETICQAPARTICIPANT"), "Page 1: participant must be synthetic");
assert.ok(pages[1].normalized.includes("QRVERIFICATION"), "Page 2: QR heading missing");
assert.ok(pages[1].normalized.includes(normalize("TERAS BASIC SCAFFOLD ERECTION PROGRAMME")), "Page 2: frozen programme title missing");
assert.ok(pages[1].normalized.includes("PARTICIPANTSKILLSRECORD"), "Page 2: skills record section missing");
for (const area of ["THEORYSESSION", "PRACTICALTRAINING", "SAFETYAWARENESS", "PRACTICALASSESSMENT", "ATTENDANCEREQUIREMENT"]) {
  assert.ok(pages[1].normalized.includes(area), `Page 2: skills area ${area} missing from the rendered table`);
}
assert.ok(pages[1].normalized.includes("ISSUINGBRANCHADDRESS"), "Page 2: Issuing Branch Address label missing");
assert.ok(pages[1].normalized.includes(normalize("JALAN TANAH MERAH")) && pages[1].normalized.includes("JITRA"), "Page 2: issuer address text missing or clipped");
console.log("c4-snapshot-preview-contract: 2 nonblank A4 pages; Golden Reference title, certificate number, QR, frozen programme content, five-area skills record and issuing branch address all verified");
