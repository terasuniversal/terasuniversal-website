import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const quotation = readFileSync(new URL("../app/admin/quotation-pdf/[id]/page.tsx", import.meta.url), "utf8");
// DOC-4: the print rules live once in `printGeometry`, applied by @media print and scoped for the A4 readiness check.
const printCss = quotation.match(/const printGeometry = `([\s\S]*?)`;/)?.[1] ?? "";
assert.ok(printCss.length > 0, "print geometry rules are declared once");

// DOC-4: papers come from the calibrated print-geometry layout, not the generic block packer.
assert.match(quotation, /const pages = layoutQuotationPages\(\{/);
assert.match(quotation, /const pageCount = pages\.length;/);
assert.doesNotMatch(quotation, /paginateMeasuredBlocks|finalReserve/);
assert.match(quotation, /@media print\{\$\{printGeometry\}\.loading-screen,\[data-print-hide\]\{display:none!important\}\}/);
assert.match(quotation, /\$\{scopePrintGeometry\(printGeometry\)\}/);
assert.match(quotation, /<DocumentPrintController [^>]*verifyA4Fit printGeometryAttribute=\{PRINT_GEOMETRY_ATTRIBUTE\}/);

assert.match(printCss, /\.quotation-print-root \.quotation-print-section\{padding-block:6px 0\}/);
assert.match(quotation, /@page\{size:A4 portrait;margin:0\}/);
assert.match(printCss, /\.quotation-print-paper\{[^}]*height:297mm[^}]*padding:10mm 12mm 20mm/);
assert.match(quotation, /\.teras-document-running-footer\{[^}]*bottom:22px/);
assert.match(quotation, /\.quotation-print-totals-wrap\{[^}]*break-inside:avoid/);
// CSS-1: the global admin "section { padding-block: 86px }" rule must not reach quotation sections on screen.
assert.match(quotation, /\.quotation-print-root \.quotation-print-section\{padding-block:10px 0\}/);

// Grand Total is rendered once, by the totals block, which the layout places after the last item.
const totalsCase = quotation.indexOf('case "totals":');
const grandTotal = quotation.indexOf("className=\"quotation-print-grand\"");
assert.ok(totalsCase >= 0 && grandTotal > totalsCase && quotation.indexOf("className=\"quotation-print-grand\"", grandTotal + 1) === -1, "Grand Total renders once, in the totals block");
assert.match(quotation, /pageNumber=\{pageIndex \+ 1\} pageCount=\{pageCount\}/);

console.log("Quotation PDF layout contract: PASS");
