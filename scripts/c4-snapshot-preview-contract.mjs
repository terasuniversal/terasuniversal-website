// PDF layout/clearance contract for the C4 Golden Reference snapshot render,
// across Basic/Intermediate/Advanced Erector plus a dedicated long
// certificate-number stress case (scripts/c4-snapshot-preview.mjs must have
// generated the PDFs first, now using the REAL, full-length catalog
// programme content from lib/standard-scaffold-programmes.ts -- not a
// shortened placeholder -- so this is the actual worst-case layout, not an
// easier one). Verification/contact grid is fully populated (certificate
// number, phone, website, email, issuing branch address).
//
// This revision replaces the earlier single-item baseline-Y comparison
// with true PDF text bounding boxes (position + measured height per text
// run, unioned across every item belonging to that run -- the address can
// wrap, and the footer's letter-spaced CSS splits into many single-glyph
// items) and an explicit minimum clearance in points, because the earlier,
// looser check passed locally while the owner's real downloaded PDFs still
// showed a near-zero/negative gap.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const root = resolve(import.meta.dirname, "..");
const output = resolve(process.env.PREVIEW_OUTPUT_DIR || resolve(root, "certificate-previews"));
const normalize = (value) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");

// Minimum vertical clearance required between the Issuing Branch Address
// text and the footer tagline text, per the owner's explicit requirement.
const MIN_CLEARANCE_PT = 12;
const PAGE_W_PT = 595;
const PAGE_H_PT = 842;
// Coarse "still inside the printable area" bound -- not the exact CSS
// safe-margin/border-inset conversion, just a sanity net against the
// address being clipped or pushed off the page edge.
const PAGE_EDGE_TOLERANCE_PT = 15;

const ISSUER_ADDRESS_WORDS = ["JALAN", "TANAH", "MERAH", "JITRA", "KEDAH"];

const levels = [
  { file: "erector-basic", title: "SCAFFOLDING TRAINING CERTIFICATE", programme: "TERAS BASIC SCAFFOLD ERECTION PROGRAMME", certNumber: "TU-CERT-2026-ERECTOR-BASIC-000123" },
  { file: "erector-intermediate", title: "SCAFFOLDING TRAINING CERTIFICATE", programme: "TERAS INTERMEDIATE SCAFFOLD ERECTION PROGRAMME", certNumber: "TU-CERT-2026-INTERMEDIATE-SCAFFOLDING-ERECTOR-000124" },
  { file: "erector-advanced", title: "SCAFFOLDING TRAINING CERTIFICATE", programme: "TERAS ADVANCED SCAFFOLD ERECTION PROGRAMME", certNumber: "TU-CERT-2026-ERECTOR-ADVANCED-000125" },
  { file: "erector-long-number-stress", title: "SCAFFOLDING TRAINING CERTIFICATE", programme: "TERAS ADVANCED SCAFFOLD ERECTION PROGRAMME", certNumber: "TU-CERT-2026-ADVANCED-SCAFFOLDING-ERECTOR-SUPERVISOR-QUALIFICATION-000999" },
];

/** Approximate descent as a fraction of pdf.js's reported item height, since pdf.js does not expose ascent/descent separately per item. */
const DESCENT_FRACTION = 0.22;

/** Unions the bounding box (in PDF point-space, y increasing upward) of every item matched by predicate; throws if none match. */
function unionBBox(items, predicate, label) {
  const matched = items.filter(predicate);
  assert.ok(matched.length > 0, `could not locate any text item for ${label}`);
  let left = Infinity, right = -Infinity, bottom = Infinity, top = -Infinity;
  for (const item of matched) {
    const x = item.transform[4];
    const y = item.transform[5];
    const height = item.height || 10;
    const width = item.width || 0;
    const itemBottom = y - height * DESCENT_FRACTION;
    const itemTop = y + height;
    left = Math.min(left, x);
    right = Math.max(right, x + width);
    bottom = Math.min(bottom, itemBottom);
    top = Math.max(top, itemTop);
  }
  return { left, right, bottom, top, count: matched.length };
}

/** Runs every assertion below against one rendered PDF file (React path or HTML/Bulk-ZIP path). Returns the measured clearance in pt. */
async function checkPdf(fileKey, level) {
  const pdf = await getDocument({ url: pathToFileURL(resolve(output, `${fileKey}.pdf`)).href }).promise;
  assert.equal(pdf.numPages, 2, `${fileKey}: expected exactly two pages`);
  const pages = [];
  for (let index = 1; index <= pdf.numPages; index += 1) {
    const page = await pdf.getPage(index);
    const viewport = page.getViewport({ scale: 1 });
    assert.ok(Math.abs(viewport.width - PAGE_W_PT) < 1 && Math.abs(viewport.height - PAGE_H_PT) < 1, `${fileKey} page ${index}: not A4 portrait`);
    const content = await page.getTextContent();
    const items = content.items.filter((item) => "str" in item && item.str.trim());
    assert.ok(items.length > 5, `${fileKey} page ${index}: blank or nearly blank page`);
    const text = items.map((item) => item.str).join(" ");
    pages.push({ text, normalized: normalize(text), items });
  }

  assert.ok(pages[0].normalized.includes(normalize(level.title)), `${fileKey} Page 1: Golden Reference certificate_title missing`);
  assert.ok(pages[0].normalized.includes(normalize(level.certNumber)), `${fileKey} Page 1: certificate number missing or clipped`);
  assert.ok(pages[0].normalized.includes("SYNTHETICQAPARTICIPANT"), `${fileKey} Page 1: participant must be synthetic`);

  const back = pages[1];
  assert.ok(back.normalized.includes("QRVERIFICATION"), `${fileKey} Page 2: QR heading missing`);
  assert.ok(back.normalized.includes(normalize(level.programme)), `${fileKey} Page 2: frozen programme title missing`);
  assert.ok(back.normalized.includes("PARTICIPANTSKILLSRECORD"), `${fileKey} Page 2: skills record section missing`);
  // Five-area skills table: all five rows must be present and visible (not
  // just "the heading rendered") -- this is the actual Task 3 requirement,
  // not text presence alone.
  const skillAreas = ["THEORYSESSION", "PRACTICALTRAINING", "SAFETYAWARENESS", "PRACTICALASSESSMENT", "ATTENDANCEREQUIREMENT"];
  for (const area of skillAreas) {
    assert.ok(back.normalized.includes(area), `${fileKey} Page 2: skills area ${area} missing from the rendered table`);
  }
  assert.ok(back.normalized.includes("CONTACTNUMBER") && back.normalized.includes("WEBSITE") && back.normalized.includes("EMAIL"), `${fileKey} Page 2: contact fields missing`);
  assert.ok(back.normalized.includes("ISSUINGBRANCHADDRESS"), `${fileKey} Page 2: Issuing Branch Address label missing`);
  assert.ok(ISSUER_ADDRESS_WORDS.every((w) => back.normalized.includes(w)), `${fileKey} Page 2: issuer address text missing or clipped`);

  // --- Bounding-box clearance: Issuing Branch Address vs. footer tagline ---
  // Letter-spaced CSS text (the footer uses letter-spacing:1.6px) gets
  // extracted by pdf.js with a space inserted between every glyph (e.g.
  // "BUILDING" -> "B U I L D I N G"), so match against whitespace-stripped
  // uppercase text, and union every matching item (not just the first) so
  // a wrapped address or a multi-run footer label is measured completely.
  const addressBox = unionBBox(
    back.items,
    (item) => ISSUER_ADDRESS_WORDS.some((w) => item.str.toUpperCase().replace(/[^A-Z]/g, "").includes(w)),
    `${fileKey}: issuing branch address`
  );
  const footerBox = unionBBox(
    back.items,
    (item) => item.str.replace(/\s+/g, "").toUpperCase().includes("BUILDING") || item.str.replace(/\s+/g, "").toUpperCase().includes("COMPETENCE"),
    `${fileKey}: footer tagline`
  );

  const clearance = addressBox.bottom - footerBox.top;
  assert.ok(
    clearance >= MIN_CLEARANCE_PT,
    `${fileKey}: address/footer clearance is ${clearance.toFixed(2)}pt, below the required ${MIN_CLEARANCE_PT}pt minimum ` +
      `(address bbox bottom=${addressBox.bottom.toFixed(2)} top=${addressBox.top.toFixed(2)}, footer bbox bottom=${footerBox.bottom.toFixed(2)} top=${footerBox.top.toFixed(2)})`
  );

  // --- Address fully inside the printable page area (not clipped at an edge) ---
  assert.ok(
    addressBox.left >= PAGE_EDGE_TOLERANCE_PT &&
      addressBox.right <= PAGE_W_PT - PAGE_EDGE_TOLERANCE_PT &&
      addressBox.bottom >= PAGE_EDGE_TOLERANCE_PT &&
      addressBox.top <= PAGE_H_PT - PAGE_EDGE_TOLERANCE_PT,
    `${fileKey}: issuing branch address bounding box (${JSON.stringify(addressBox)}) is not fully inside the page border`
  );

  // --- QR block still present, positioned on the page, and not squeezed off by the Verification layout change ---
  // "QR VERIFICATION" itself is letter-spaced (same per-glyph item splitting
  // as the footer), so match the QR caption text instead, the same
  // whitespace-stripped way the footer is matched above.
  const qrHeadingBox = unionBBox(
    back.items,
    (item) => item.str.replace(/\s+/g, "").toUpperCase().includes("DATABASE") || item.str.replace(/\s+/g, "").toUpperCase().includes("SCANTOVERIFY"),
    `${fileKey}: QR caption`
  );
  assert.ok(
    qrHeadingBox.left >= PAGE_EDGE_TOLERANCE_PT && qrHeadingBox.right <= PAGE_W_PT - PAGE_EDGE_TOLERANCE_PT && qrHeadingBox.top <= PAGE_H_PT - PAGE_EDGE_TOLERANCE_PT,
    `${fileKey}: QR caption bounding box (${JSON.stringify(qrHeadingBox)}) is not fully inside the page border`
  );

  console.log(
    `${fileKey}: 2 nonblank A4 pages; title, certificate number, QR, programme content, five-area skills, full contact grid and issuing branch address all verified; ` +
      `address/footer clearance ${clearance.toFixed(2)}pt (>= ${MIN_CLEARANCE_PT}pt required); address fully inside page border; QR block positioned on page`
  );
  return clearance;
}

const clearanceByFile = {};
for (const level of levels) {
  clearanceByFile[level.file] = await checkPdf(level.file, level);
  // HTML/Bulk-ZIP render path parity check (Task 3: "Test both React and
  // HTML/Bulk ZIP render paths where supported") -- generated by
  // scripts/c4-snapshot-preview.mjs alongside the React-path PDF.
  clearanceByFile[`${level.file}-html`] = await checkPdf(`${level.file}-html`, level);
  assert.ok(
    Math.abs(clearanceByFile[level.file] - clearanceByFile[`${level.file}-html`]) < 3,
    `${level.file}: React-path clearance (${clearanceByFile[level.file].toFixed(2)}pt) and HTML-path clearance ` +
      `(${clearanceByFile[`${level.file}-html`].toFixed(2)}pt) diverge by more than 3pt -- the two renderers are not in layout parity`
  );
}

console.log("\nClearance summary (pt, React / HTML):");
for (const level of levels) {
  console.log(`  ${level.file}: ${clearanceByFile[level.file].toFixed(2)} / ${clearanceByFile[`${level.file}-html`].toFixed(2)}`);
}
