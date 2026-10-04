import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const quotation = readFileSync(new URL("../app/admin/quotation-pdf/[id]/page.tsx", import.meta.url), "utf8");
const printCss = quotation.match(/@media print\{([\s\S]*?)\}\s*@media screen/)?.[1] ?? "";

assert.match(quotation, /const quotationTotalsReserve = 8 \+ 3 \* \(14 \+ 10\) \+ \(18 \+ 13 \+ 4\);/);
assert.equal(8 + 3 * (14 + 10) + (18 + 13 + 4), 115, "totals reserve covers three regular rows, Grand Total, and print margin");
assert.match(quotation, /const finalReserve = 190 \+ quotationTotalsReserve \+ estimateBlockHeight/);
assert.match(quotation, /firstPageHeight: Math\.max\(220, 650 - finalReserve\)/);
assert.match(quotation, /finalPageReserve: finalReserve/);
assert.match(quotation, /const pageCount = itemPages\.length;/);
assert.match(printCss, /\.quotation-print-root \.quotation-print-section\{padding-block:6px 0\}/);
assert.match(quotation, /@page\{size:A4 portrait;margin:0\}/);
assert.match(printCss, /\.quotation-print-paper\{[^}]*height:297mm[^}]*padding:10mm 12mm 20mm/);
assert.match(quotation, /\.teras-document-running-footer\{[^}]*bottom:22px/);
assert.match(quotation, /\.quotation-print-totals-wrap\{[^}]*break-inside:avoid/);

const finalPageStart = quotation.indexOf("pageIndex === pageCount - 1 && <>");
const grandTotal = quotation.indexOf("className=\"quotation-print-grand\"");
assert.ok(finalPageStart >= 0 && grandTotal > finalPageStart, "Grand Total remains in the final paginated page block");
assert.match(quotation, /pageNumber=\{pageIndex \+ 1\} pageCount=\{pageCount\}/);

console.log("Quotation PDF layout contract: PASS");
