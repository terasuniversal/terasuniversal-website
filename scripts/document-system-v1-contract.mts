import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { quotationTermsText } from "../lib/documents/company.ts";
import { estimateBlockHeight, paginateMeasuredBlocks } from "../lib/documents/pagination.ts";

const quotation = readFileSync(new URL("../app/admin/quotation-pdf/[id]/page.tsx", import.meta.url), "utf8");
const invoice = readFileSync(new URL("../app/admin/invoice-pdf/[id]/page.tsx", import.meta.url), "utf8");
const config = readFileSync(new URL("../lib/documents/company.ts", import.meta.url), "utf8");
const primitives = readFileSync(new URL("../components/admin/documents/DocumentHeader.tsx", import.meta.url), "utf8");

assert.match(config, /201201003207 \(976732-P\)/);
assert.match(config, /Tel: 019-512 3834 · Web: www\.terasuniversal\.com\.my/);
assert.match(config, /SSM TERBARU\.pdf/);
assert.match(primitives, /COMPANY_DOCUMENT_CONFIG\.legalName/);
assert.match(primitives, /DocumentFooter/);
assert.match(primitives, /COMPANY_DOCUMENT_CONFIG\.contactLine/);
assert.match(quotation, /DocumentHeader type="QUOTATION"/);
assert.match(quotation, /quotationTermsText/);
assert.match(quotation, /pageNumber=\{pageIndex \+ 1\}/);
assert.match(quotation, /pageCount=\{pageCount\}/);
assert.doesNotMatch(quotation, /counter\(page\)|counter\(pages\)/);
assert.doesNotMatch(quotation, /Page 0 of 0/);
assert.doesNotMatch(invoice, /202201038223 \(1477529-X\)/);
assert.match(invoice, /DocumentHeader type="INVOICE"/);
assert.match(invoice, /Training \/ Programme Summary/);
assert.match(invoice, /Amount Paid/);
assert.match(invoice, /inv-pdf-balance/);
assert.match(invoice, /paymentInstructions/);
assert.doesNotMatch(invoice, /Accomadation/);
assert.doesNotMatch(invoice, /This quotation is valid for 30 days/);
assert.doesNotMatch(invoice, /Bank transfer details to be provided/);
// DOC-3: invoice papers come from the calibrated layout, not the generic block packer.
assert.match(invoice, /layoutInvoicePages\(/);
assert.match(invoice, /const pageCount = pages\.length/);
// DOC-2: invoice and quotation print through the readiness controller, never an unconditional inline script.
for (const doc of [invoice, quotation]) {
  assert.match(doc, /<DocumentPrintController /);
  assert.doesNotMatch(doc, /PRINT_WHEN_READY_SCRIPT/);
  assert.match(doc, /\.loading-screen,\s*\[data-print-hide\]\s*\{\s*display:\s*none\s*!important/);
}
// Both verify A4 fit before printing: the invoice on its screen paper (calibrated to fit), the quotation in its
// print geometry (DOC-4), because its preview uses larger type than its print CSS.
assert.match(invoice, /<DocumentPrintController [^>]*verifyA4Fit/);
assert.match(quotation, /<DocumentPrintController [^>]*verifyA4Fit printGeometryAttribute=/);
// DOC-3: the global admin "section { padding-block: 86px }" rule must not reach invoice sections.
assert.match(invoice, /\.inv-pdf-page \.inv-pdf-section \{ margin: 22px 0; padding: 10px 0 0;/);
assert.match(invoice, /pageNumber=\{pageIndex \+ 1\}/);
assert.match(invoice, /pageCount=\{pageCount\}/);
assert.match(invoice, /font-variant-numeric: tabular-nums/);
assert.match(invoice, /white-space: nowrap/);
assert.doesNotMatch(invoice, /counter\(page\)|counter\(pages\)/);
assert.doesNotMatch(invoice, /quotation\.\{0,20\}valid|valid\.\{0,20\}days/);

const formatDate = (value: string) => value;
assert.match(quotationTermsText("Payment is valid for 30 days for budget approval.", "2026-12-31", formatDate), /Payment is valid for 30 days/);
assert.match(quotationTermsText("Please quote the invoice reference in all correspondence.", null, formatDate), /invoice reference/);
assert.match(quotationTermsText("Line one.\nLine two.", null, formatDate), /Line one\.\nLine two\./);
assert.match(quotationTermsText("", null, formatDate), /no expiry date/);

const paginate = (count: number, height = 40) => paginateMeasuredBlocks(
  Array.from({ length: count }, (_, index) => ({ id: String(index), value: index, height })),
  { firstPageHeight: 100, continuationPageHeight: 100, finalPageReserve: 20 },
);
assert.deepEqual(paginate(0), [[]]);
assert.deepEqual(paginate(1), [[0]]);
assert.deepEqual(paginate(2), [[0, 1]]);
assert.deepEqual(paginate(3), [[0, 1], [2]]);
assert.equal(paginate(31).flat().length, 31);
assert.equal(estimateBlockHeight("line one\nline two", 8, 10, 4), 24);

console.log("Document System V1 contract passed.");
