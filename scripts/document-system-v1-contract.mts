import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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

console.log("Document System V1 contract passed.");
