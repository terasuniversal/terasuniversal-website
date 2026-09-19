import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { quotationTermsText } from "../lib/documents/company.ts";
import { estimateBlockHeight, paginateMeasuredBlocks } from "../lib/documents/pagination.ts";

const quotation = readFileSync(new URL("../app/admin/quotation-pdf/[id]/page.tsx", import.meta.url), "utf8");
const invoice = readFileSync(new URL("../app/admin/invoice-pdf/[id]/page.tsx", import.meta.url), "utf8");
const config = readFileSync(new URL("../lib/documents/company.ts", import.meta.url), "utf8");
const primitives = readFileSync(new URL("../components/admin/documents/DocumentHeader.tsx", import.meta.url), "utf8");

assert.match(config, /201201003207 \(976732-P\)/);
assert.match(config, /SSM TERBARU\.pdf/);
assert.match(primitives, /COMPANY_DOCUMENT_CONFIG\.legalName/);
assert.match(primitives, /DocumentFooter/);
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
assert.match(invoice, /itemChunks/);
assert.match(invoice, /const pageCount = itemChunks\.length/);
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
