import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const pageCss = `
  @page { size: A4 portrait; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #eef1f6; }
  body { font-family: Arial, sans-serif; color: #1a2233; }
  .paper { width: 210mm; height: 297mm; padding: 14mm; background: #fff; page-break-after: always; break-after: page; position: relative; }
  .paper:last-child { page-break-after: auto; break-after: auto; }
  .header { border-bottom: 3px solid #0b3a63; padding-bottom: 8mm; color: #0b3a63; }
  .title { font-size: 22px; font-weight: 800; letter-spacing: 2px; }
  .receipt-header { display: flex; justify-content: space-between; gap: 18mm; align-items: flex-start; }
  .receipt-brand { min-width: 0; }
  .receipt-brand img { width: 42mm; height: auto; display: block; }
  .receipt-company { margin-top: 2mm; font-size: 10px; font-weight: 800; letter-spacing: .8px; }
  .receipt-registration, .receipt-address { color: #667085; font-size: 8px; line-height: 1.4; }
  .receipt-registration { margin-top: 1mm; }
  .receipt-address { max-width: 62mm; margin-top: 1mm; }
  .receipt-meta { min-width: 53mm; text-align: right; font-size: 8px; color: #667085; }
  .receipt-meta .title { color: #0b3a63; font-size: 20px; margin-bottom: 4mm; }
  .receipt-meta-row { display: grid; grid-template-columns: 1fr auto; gap: 5mm; margin-top: 1.5mm; }
  .receipt-meta-row strong { color: #1a2233; white-space: nowrap; }
  .invoice-header { display: flex; justify-content: space-between; gap: 18mm; align-items: flex-start; border-bottom: 3px solid #0b3a63; padding-bottom: 6mm; margin-bottom: 6mm; }
  .invoice-brand { min-width: 0; }
  .invoice-brand img { width: 42mm; height: auto; display: block; }
  .invoice-company { margin-top: 2mm; color: #0b3a63; font-size: 10px; font-weight: 800; letter-spacing: .8px; }
  .invoice-registration, .invoice-address { color: #667085; font-size: 8px; line-height: 1.4; }
  .invoice-registration { margin-top: 1mm; }
  .invoice-address { max-width: 62mm; margin-top: 1mm; }
  .invoice-meta { min-width: 53mm; text-align: right; font-size: 8px; color: #667085; }
  .invoice-meta .title { color: #0b3a63; font-size: 20px; margin-bottom: 4mm; }
  .invoice-meta-row { display: grid; grid-template-columns: 1fr auto; gap: 5mm; margin-top: 1.5mm; }
  .invoice-meta-row strong { color: #1a2233; white-space: nowrap; }
  .invoice-header.continued { align-items: center; padding-bottom: 3mm; margin-bottom: 4mm; }
  .invoice-header.continued .invoice-brand img { width: 26mm; }
  .invoice-header.continued .invoice-company, .invoice-header.continued .invoice-registration, .invoice-header.continued .invoice-address { display: none; }
  .invoice-header.continued .invoice-meta .title { margin: 0; font-size: 15px; }
  .items { width: 100%; border-collapse: collapse; margin-top: 8mm; font-size: 10px; }
  .items th { background: #0b3a63; color: white; text-align: left; padding: 5px; }
  .items td { border-bottom: 1px solid #d9e1ea; padding: 5px; vertical-align: top; }
  .footer { position: absolute; left: 14mm; right: 14mm; bottom: 8mm; border-top: 1px solid #d9e1ea; padding-top: 3mm; font-size: 8px; display: flex; justify-content: space-between; }
  .long { white-space: pre-wrap; overflow-wrap: anywhere; }
  .receipt-fixture-section { margin-top: 3.5mm; padding-top: 2mm; border-top: 1px solid #e8edf3; }
  .receipt-fixture-title { margin: 0 0 2mm; color: #0b3a63; font-size: 10px; font-weight: 800; letter-spacing: 1px; }
  .receipt-fixture-title::after { content: ""; display: block; width: 7mm; margin-top: 1mm; border-bottom: 2px solid #d4af37; }
  .receipt-fixture-card { padding: 2mm 3mm; border: 1px solid #e3e9f0; line-height: 1.3; overflow-wrap: anywhere; }
  .receipt-fixture-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2mm; }
  .receipt-fixture-amount { margin-top: 3mm; padding: 3mm 5mm; background: #f5f8fb; border-left: 1.5mm solid #d4af37; color: #0b3a63; }
  .receipt-fixture-amount-label { font-size: 9px; font-weight: 800; letter-spacing: 1px; }
  .receipt-fixture-amount-value { margin-top: 1.5mm; font-size: 22px; font-weight: 800; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .receipt-fixture-summary { width: 100%; max-width: 95mm; margin-left: auto; border-collapse: collapse; font-size: 10px; font-variant-numeric: tabular-nums; }
  .receipt-fixture-summary td { padding: 1mm 2mm; border-bottom: 1px solid #e8edf3; }
  .receipt-fixture-summary td:last-child { text-align: right; white-space: nowrap; }
  .receipt-fixture-balance td { border-top: 2px solid #0b3a63; border-bottom: 2px solid #d4af37; color: #0b3a63; font-weight: 800; }
  .receipt-fixture-refunded { margin-bottom: 4mm; padding: 2mm 3mm; border: 1.5px solid #9a6700; color: #9a6700; font-size: 12px; font-weight: 800; letter-spacing: 1.5px; text-align: center; }
  .invoice-payment-qr { display: grid; grid-template-columns: 42mm 1fr; gap: 6mm; align-items: center; break-inside: avoid; page-break-inside: avoid; }
  .invoice-payment-qr > div:first-child { display: grid; justify-items: center; gap: 1.5mm; }
  .invoice-payment-qr img { display: block; width: 36mm; height: 36mm; max-width: 100%; object-fit: contain; }
  .invoice-payment-qr-label { color: #0b3a63; font-size: 8px; font-weight: 800; text-align: center; }
  .invoice-payment-details { display: grid; gap: 2.5mm; font-size: 10px; }
  .invoice-payment-details small { display: block; margin-bottom: 1mm; color: #667085; font-size: 8px; text-transform: uppercase; }
  .invoice-payment-reference { color: #0b3a63; font-weight: 800; }
`;


function page(title: string, pageNumber: number, pageCount: number, body: string): string {
  return `<section class="paper"><header class="header"><div>TERAS UNIVERSAL SDN. BHD.</div><div class="title">${title}</div></header>${body}<footer class="footer"><span>TERAS UNIVERSAL SDN. BHD.</span><span>Page ${pageNumber} of ${pageCount}</span></footer></section>`;
}

function invoicePage(pageNumber: number, pageCount: number, body: string, logoData: string, continued = false): string {
  const meta = continued
    ? `<div class="invoice-meta"><div class="title">INVOICE — Continued</div></div>`
    : `<div class="invoice-meta"><div class="title">INVOICE</div><div class="invoice-meta-row"><span>Invoice No.</span><strong>INV-2026-0042</strong></div><div class="invoice-meta-row"><span>Invoice Date</span><strong>20 Sept 2026</strong></div><div class="invoice-meta-row"><span>Due Date</span><strong>20 Oct 2026</strong></div><div class="invoice-meta-row"><span>Quotation Ref.</span><strong>QT-2026-0042</strong></div></div>`;
  return `<section class="paper"><header class="invoice-header${continued ? " continued" : ""}"><div class="invoice-brand"><img src="data:image/svg+xml;base64,${logoData}" alt="TERAS Universal"><div class="invoice-company">TERAS UNIVERSAL SDN. BHD.</div><div class="invoice-registration">Company Registration No. 201201003207 (976732-P)</div><div class="invoice-address">Lot 1961, Kampung Tanah Merah,<br>Tanah Merah Dalam,<br>06000 Jitra, Kedah.</div></div>${meta}</header>${body}<footer class="footer"><span>TERAS UNIVERSAL SDN. BHD. · INV-2026-0042</span><span>Page ${pageNumber} of ${pageCount}</span></footer></section>`;
}

function receiptPage(
  pageNumber: number,
  pageCount: number,
  body: string,
  logoData: string,
  metadata: { receiptNo?: string; receiptDate?: string; invoiceRef?: string } = {},
): string {
  const receiptNo = metadata.receiptNo ?? "RCPT-2026-0001";
  const receiptDate = metadata.receiptDate ?? "19 Sept 2026";
  const invoiceRef = metadata.invoiceRef ?? "INV-2026-0003";
  return `<section class="paper"><header class="header receipt-header"><div class="receipt-brand"><img src="data:image/svg+xml;base64,${logoData}" alt="TERAS Universal"><div class="receipt-company">TERAS UNIVERSAL SDN. BHD.</div><div class="receipt-registration">Company Registration No. 201201003207 (976732-P)</div><div class="receipt-address">Lot 1961, Kampung Tanah Merah,<br>Tanah Merah Dalam,<br>06000 Jitra, Kedah.</div></div><div class="receipt-meta"><div class="title">RECEIPT</div><div class="receipt-meta-row"><span>Receipt No.</span><strong>${receiptNo}</strong></div><div class="receipt-meta-row"><span>Receipt Date</span><strong>${receiptDate}</strong></div><div class="receipt-meta-row"><span>Invoice Ref.</span><strong>${invoiceRef}</strong></div></div></header>${body}<footer class="footer"><span>TERAS UNIVERSAL SDN. BHD. · ${receiptNo}</span><span>Page ${pageNumber} of ${pageCount}</span></footer></section>`;
}

function itemTable(prefix: string, start: number, count: number, long = false): string {
  const rows = Array.from({ length: count }, (_, offset) => {
    const number = start + offset;
    const description = long && number === start
      ? `${prefix} ${number.toString().padStart(2, "0")} — ${"Long description package detail ".repeat(18)}`
      : `${prefix} ${number.toString().padStart(2, "0")}`;
    return `<tr><td>${number}</td><td class="long">${description}</td><td>1</td><td>RM 130.00</td></tr>`;
  }).join("");
  return `<table class="items"><thead><tr><th>No.</th><th>Description</th><th>Qty</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function quotationHtml(): string {
  const pages = [
    page("QUOTATION", 1, 4, `<p>Customer / Company: Long Company Name for deterministic stress coverage</p><p class="long">Participants:\n${Array.from({ length: 35 }, (_, index) => `Participant ${index + 1}`).join("\n")}</p>${itemTable("Module", 1, 5, true)}`),
    page("QUOTATION — Continued", 2, 4, itemTable("Module", 6, 6)),
    page("QUOTATION — Continued", 3, 4, itemTable("Module", 12, 4)),
    page("QUOTATION — Continued", 4, 4, `${itemTable("Module", 16, 3)}<p class="long">Terms / Notes: ${"Long terms and notes preserved exactly. ".repeat(30)}</p><strong>Grand Total RM 2,340.00</strong>`),
  ];
  return `<!doctype html><html><head><style>${pageCss}</style></head><body>${pages.join("")}</body></html>`;
}

function invoiceHtml(logoData: string): string {
  const pages = [
    invoicePage(1, 3, `<p>Bill To: Long Billing Company<br>${"Long billing address line. ".repeat(18)}</p>${itemTable("Invoice Item", 1, 11, true)}`, logoData),
    invoicePage(2, 3, itemTable("Invoice Item", 12, 11), logoData, true),
    invoicePage(3, 3, `${itemTable("Invoice Item", 23, 8)}<p class="long">Payment terms: ${"Payment reference and settlement terms preserved. ".repeat(24)}</p><p>Grand Total RM 3,900.00</p><p>Amount Paid RM 1,000.00</p><p>Balance Due RM 2,900.00</p>`, logoData, true),
  ];
  return `<!doctype html><html><head><style>${pageCss}</style></head><body>${pages.join("")}</body></html>`;
}

function invoicePaymentInstructionsHtml(qrData: string, multiPage: boolean, logoData: string): string {
  const instructions = `<section class="receipt-fixture-section"><h2 class="receipt-fixture-title">PAYMENT INSTRUCTIONS</h2><div class="invoice-payment-qr"><div><img src="data:image/png;base64,${qrData}" alt="Official TERAS Universal DuitNow QR"><div class="invoice-payment-qr-label">DuitNow QR<br>Scan to Pay</div></div><div class="invoice-payment-details"><div><small>Bank</small><strong>Maybank · MAE by Maybank2u</strong></div><div><small>Account Name</small><strong>TERAS UNIVERSAL SDN. BHD.</strong></div><div class="invoice-payment-reference"><small>Payment Reference</small>Please use Invoice No. INV-2026-0042 as your payment reference.</div></div></div></section>`;
  if (!multiPage) {
    const body = `<p>Bill To: Sanitized Customer Sdn. Bhd.</p>${itemTable("Invoice Item", 1, 2)}<p>Grand Total RM 1,000.00</p>${instructions}`;
    return `<!doctype html><html><head><style>${pageCss}</style></head><body>${invoicePage(1, 1, body, logoData)}</body></html>`;
  }
  const pages = [
    invoicePage(1, 3, `<p>Bill To: Long Billing Company</p>${itemTable("Invoice Item", 1, 11, true)}`, logoData),
    invoicePage(2, 3, itemTable("Invoice Item", 12, 11), logoData, true),
    invoicePage(3, 3, `${itemTable("Invoice Item", 23, 8)}<p>Grand Total RM 3,900.00</p>${instructions}`, logoData, true),
  ];
  return `<!doctype html><html><head><style>${pageCss}</style></head><body>${pages.join("")}</body></html>`;
}

function splitReceiptNotes(value: string, wordsPerBlock: number): string[] {
  const chunks: string[] = [];
  const paragraphs = value.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean);
  let current: string[] = [];
  let currentWordCount = 0;
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/);
    if (current.length > 0 && currentWordCount + words.length > wordsPerBlock) {
      chunks.push(current.join("\n\n"));
      current = [];
      currentWordCount = 0;
    }
    current.push(paragraph);
    currentWordCount += words.length;
  }
  if (current.length > 0) chunks.push(current.join("\n\n"));
  return chunks;
}

function notesForContract(kind: "long" | "multipage"): string {
  return kind === "long"
    ? Array.from({ length: 18 }, (_, index) => `Paragraph ${String(index + 1).padStart(2, "0")}: Long receipt notes preserved for customer-facing financial records.`).join("\n\n")
    : Array.from({ length: 9 }, (_, index) => `Section ${String(index + 1).padStart(2, "0")}: Programme attendance and payment confirmation context is retained without duplicating invoice line items.`).join("\n\n");
}

function receiptHtml(kind: "partial" | "paid" | "long" | "multipage" | "refunded", logoData: string): string {
  const isPaid = kind === "paid";
  const isLong = kind === "long" || kind === "multipage";
  const isRefunded = kind === "refunded";
  const customer = isLong && kind === "long" ? "Long Customer / Company Name ".repeat(6) : "Sanitized Customer Sdn. Bhd.";
  const reference = isLong && kind === "long" ? "PAYMENT-REFERENCE-".repeat(12) : "PAY-2026-0001";
  const notes = kind === "long" || kind === "multipage" ? notesForContract(kind) : "Payment received and recorded.";
  const noteChunks = splitReceiptNotes(notes, kind === "multipage" ? 24 : 55);
  const pageNotes: Array<string | null> = isLong ? [null, ...noteChunks] : noteChunks;
  const pageCount = pageNotes.length;
  const pages = pageNotes.map((note, index) => {
    const body = index === 0
      ? `${isRefunded ? "<div class=\"receipt-fixture-refunded\">REFUNDED RECEIPT</div>" : ""}<section class="receipt-fixture-section"><h2 class="receipt-fixture-title">RECEIVED FROM</h2><div class="receipt-fixture-card"><strong>${customer}</strong></div></section><section class="receipt-fixture-section"><h2 class="receipt-fixture-title">PAYMENT FOR</h2><div class="receipt-fixture-card"><strong>Invoice Ref. INV-2026-0003</strong><div>Receipt confirmation for payment received against this invoice.</div></div></section><div class="receipt-fixture-amount"><div class="receipt-fixture-amount-label">AMOUNT RECEIVED</div><div class="receipt-fixture-amount-value">RM 3,000.00</div></div><section class="receipt-fixture-section"><h2 class="receipt-fixture-title">PAYMENT DETAILS</h2><div class="receipt-fixture-grid"><div class="receipt-fixture-card"><strong>Payment Method</strong><br>Bank Transfer</div><div class="receipt-fixture-card"><strong>Payment Date</strong><br>19 Sept 2026</div><div class="receipt-fixture-card"><strong>Payment Reference</strong><br><span class="long">${reference}</span></div></div></section><section class="receipt-fixture-section"><h2 class="receipt-fixture-title">PAYMENT SUMMARY</h2><table class="receipt-fixture-summary"><tbody><tr><td>Invoice Total</td><td>RM 8,850.00</td></tr><tr><td>Total Paid To Date</td><td>RM ${isPaid ? "8,850.00" : "5,000.00"}</td></tr><tr class="receipt-fixture-balance"><td>Balance Remaining</td><td>RM ${isPaid ? "0.00" : "3,850.00"}</td></tr></tbody></table>${isPaid ? "<div style=\"margin-top:3mm;color:#0b3a63;font-weight:800;text-align:right\">PAID IN FULL</div>" : ""}</section>${isLong ? "" : `<section class="receipt-fixture-section"><h2 class="receipt-fixture-title">NOTES</h2><div class="receipt-fixture-card long">${note}</div></section>`}`
      : `<section class="receipt-fixture-section"><h2 class="receipt-fixture-title">${isLong && index === 1 ? "NOTES" : "NOTES — Continued"}</h2><div class="receipt-fixture-card long">${note ?? ""}</div></section>`;
    return receiptPage(index + 1, pageCount, body, logoData);
  });
  return `<!doctype html><html><head><style>${pageCss}</style></head><body>${pages.join("")}</body></html>`;
}

async function renderPdf(browser: Awaited<ReturnType<typeof chromium.launch>>, html: string, outputPath: string): Promise<void> {
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "load" });
    await page.pdf({ path: outputPath, format: "A4", printBackground: true, margin: { top: "0", right: "0", bottom: "0", left: "0" } });
  } finally {
    await page.close();
  }
}

async function renderPng(browser: Awaited<ReturnType<typeof chromium.launch>>, html: string, outputPath: string): Promise<void> {
  const page = await browser.newPage({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 1 });
  try {
    await page.setContent(html, { waitUntil: "load" });
    await page.emulateMedia({ media: "print" });
    await page.screenshot({ path: outputPath, fullPage: false });
  } finally {
    await page.close();
  }
}

async function renderPagePng(browser: Awaited<ReturnType<typeof chromium.launch>>, html: string, outputPath: string, pageIndex: number): Promise<void> {
  const page = await browser.newPage({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 1 });
  try {
    await page.setContent(html, { waitUntil: "load" });
    await page.emulateMedia({ media: "print" });
    await page.evaluate((top) => window.scrollTo(0, top), pageIndex * 1123);
    await page.screenshot({ path: outputPath, fullPage: false });
  } finally {
    await page.close();
  }
}

async function extractPages(path: string): Promise<string[]> {
  const document = await getDocument({ url: path }).promise;
  const pages: string[] = [];
  for (let index = 1; index <= document.numPages; index += 1) {
    const current = await document.getPage(index);
    const content = await current.getTextContent();
    pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join("\n"));
  }
  return pages;
}

function assertLabels(pages: string[], expectedCount: number): void {
  assert.equal(pages.length, expectedCount, `expected ${expectedCount} physical pages, got ${pages.length}`);
  const fullText = pages.join("\n");
  assert.ok(!fullText.includes("Page 0 of 0"));
  for (let index = 1; index <= expectedCount; index += 1) {
    assert.ok(pages[index - 1].includes(`Page ${index} of ${expectedCount}`), `missing Page ${index} of ${expectedCount}`);
  }
}

function assertItemsExactlyOnce(text: string, prefix: string, first: number, last: number): void {
  for (let number = first; number <= last; number += 1) {
    const label = `${prefix} ${number.toString().padStart(2, "0")}`;
    assert.equal(text.split(label).length - 1, 1, `${label} must occur exactly once`);
  }
}

function stagingReceiptHtml(logoData: string): string {
  const fixture = {
    receiptNo: "RCPT-2026-0001",
    receiptDate: "20 Sept 2026",
    invoiceRef: "INV-2026-0037",
    amountReceived: "RM 400.00",
    invoiceTotal: "RM 1,000.00",
    totalPaid: "RM 400.00",
    balance: "RM 600.00",
    paymentDate: "20 Sept 2026",
  };
  const body = `<section class="receipt-fixture-section"><h2 class="receipt-fixture-title">RECEIVED FROM</h2><div class="receipt-fixture-grid"><div class="receipt-fixture-card"><strong>TERAS QA Receipt Customer</strong><div>TERAS QA E2E SDN. BHD.</div></div><div class="receipt-fixture-card"><strong>Contact</strong><div>qa-receipt-e2e@example.invalid</div></div></div></section><section class="receipt-fixture-section"><h2 class="receipt-fixture-title">PAYMENT FOR</h2><div class="receipt-fixture-card"><strong>Invoice Ref. ${fixture.invoiceRef}</strong><div>Receipt confirmation for payment received against this invoice.</div></div></section><div class="receipt-fixture-amount"><div class="receipt-fixture-amount-label">AMOUNT RECEIVED</div><div class="receipt-fixture-amount-value">${fixture.amountReceived}</div></div><section class="receipt-fixture-section"><h2 class="receipt-fixture-title">PAYMENT DETAILS</h2><div class="receipt-fixture-grid"><div class="receipt-fixture-card"><strong>Payment Method</strong><br>Bank Transfer</div><div class="receipt-fixture-card"><strong>Payment Date</strong><br>${fixture.paymentDate}</div><div class="receipt-fixture-card"><strong>Payment Reference</strong><br><span class="long">QA-RECEIPT-E2E-20260920</span></div></div></section><section class="receipt-fixture-section"><h2 class="receipt-fixture-title">PAYMENT SUMMARY</h2><table class="receipt-fixture-summary"><tbody><tr><td>Invoice Total</td><td>${fixture.invoiceTotal}</td></tr><tr><td>Total Paid To Date</td><td>${fixture.totalPaid}</td></tr><tr class="receipt-fixture-balance"><td>Balance Remaining</td><td>${fixture.balance}</td></tr></tbody></table></section><section class="receipt-fixture-section"><h2 class="receipt-fixture-title">NOTES</h2><div class="receipt-fixture-card long">QA-RECEIPT-E2E-20260920</div></section>`;
  return `<!doctype html><html><head><style>${pageCss}</style></head><body>${receiptPage(1, 1, body, logoData, fixture)}</body></html>`;
}

async function assertStagingReceiptPdf(path: string): Promise<void> {
  const document = await getDocument({ url: path }).promise;
  assert.equal(document.numPages, 1, "staging Receipt fixture must remain one PDF page");
  const page = await document.getPage(1);
  const content = await page.getTextContent();
  const items = content.items.filter((item): item is typeof item & { str: string; transform: number[] } => "str" in item && "transform" in item);
  const text = items.map((item) => item.str).join(" ").replace(/\s+/g, " ");
  for (const expected of ["PAYMENT SUMMARY", "Invoice Total", "RM 1,000.00", "Total Paid To Date", "RM 400.00", "Balance Remaining", "RM 600.00", "Page 1 of 1"]) {
    assert.ok(text.includes(expected), `generated staging PDF missing ${expected}`);
  }
  assert.ok(!text.includes("PAID IN FULL"), "partial-payment staging PDF must not say PAID IN FULL");
  assert.ok(text.includes("Bank Transfer") && !text.includes("Bank Transfer — Bank Transfer"), "identical provider/method labels must not be duplicated");
  assert.equal(text.split("INV-2026-0037").length - 1, 2, "header and Payment For must share the same invoice reference");
  assert.ok(text.includes("Receipt Date") && text.includes("20 Sept 2026"), "Receipt Date must match the persisted fixture date");
  assert.ok(text.includes("Payment Date") && (text.split("20 Sept 2026").length - 1) >= 2, "manual payment Receipt Date must equal Payment Date");
  assert.ok(!text.includes("INV-2026-0003") && !text.includes("19 Sept 2026"), "stale fixture metadata must not leak into staging-like PDF");
  const yFor = (needle: string) => {
    const item = items.find((candidate) => candidate.str.replace(/\s+/g, " ").includes(needle));
    assert.ok(item, `generated staging PDF missing coordinate anchor ${needle}`);
    return item.transform[5];
  };
  const summaryY = yFor("PAYMENT SUMMARY");
  const footerY = yFor("Page 1 of 1");
  assert.ok(summaryY > footerY, "Payment Summary must be above the footer in the generated PDF");
  assert.ok(summaryY - footerY > 24, "Payment Summary must not overlap the footer in the generated PDF");
}

async function assertInvoicePaymentQrPdf(path: string, expectedPages: number, baselinePath: string): Promise<void> {
  const document = await getDocument({ url: path }).promise;
  assert.equal(document.numPages, expectedPages, `Invoice QR fixture must have ${expectedPages} page(s)`);
  const pages: string[] = [];
  for (let index = 1; index <= document.numPages; index += 1) {
    const current = await document.getPage(index);
    const content = await current.getTextContent();
    pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" ").replace(/\s+/g, " "));
  }
  const finalText = pages.at(-1) ?? "";
  assert.ok(pages[0].includes("201201003207 (976732-P)"), "Invoice must include the official company registration number");
  assert.ok(pages[0].includes("06000 Jitra, Kedah."), "Invoice must include the official company address");
  if (expectedPages > 1) assert.ok(pages.slice(1).every((text) => text.replace(/\s+/g, "").includes("INVOICE—Continued")), "Invoice continuation pages must retain compact corporate identity");
  for (const expected of ["PAYMENT INSTRUCTIONS", "DuitNow QR", "Scan to Pay", "Maybank", "TERAS UNIVERSAL SDN. BHD.", "Invoice No. INV-2026-0042"]) {
    assert.ok(finalText.includes(expected), `Invoice QR PDF missing ${expected}`);
  }
  assert.ok(!pages.slice(0, -1).some((text) => text.includes("PAYMENT INSTRUCTIONS")), "Payment Instructions must belong to the final Invoice page");
  assert.ok(finalText.includes(`Page ${expectedPages} of ${expectedPages}`), "final Invoice page numbering is incorrect");
  const finalPage = await document.getPage(expectedPages);
  const finalContent = await finalPage.getTextContent();
  const items = finalContent.items.filter((item): item is typeof item & { str: string; transform: number[] } => "str" in item && "transform" in item);
  const yFor = (needle: string) => {
    const item = items.find((candidate) => candidate.str.replace(/\s+/g, " ").includes(needle));
    assert.ok(item, `Invoice QR PDF missing coordinate anchor ${needle}`);
    return item.transform[5];
  };
  assert.ok(yFor("PAYMENT INSTRUCTIONS") > yFor(`Page ${expectedPages} of ${expectedPages}`), "QR section must be above the footer");
  const qrBytes = await readFile(path, "binary");
  const baselineBytes = await readFile(baselinePath, "binary");
  assert.ok(qrBytes.includes("/Subtype /Image"), "Invoice QR PDF must contain a rendered QR image");
  assert.ok(qrBytes.includes("/Width 700") && qrBytes.includes("/Height 699"), "Invoice QR PDF must contain the cropped QR-only asset dimensions");
  assert.ok(baselineBytes.length > 0, "Invoice corporate-header baseline PDF must be generated");
}

async function main(): Promise<void> {
  const workspace = await mkdtemp(join(tmpdir(), "teras-document-system-v1-"));
  const reviewArtifactDir = process.env.TERAS_REVIEW_ARTIFACT_DIR;
  if (reviewArtifactDir) await mkdir(reviewArtifactDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const logoData = Buffer.from(await readFile(new URL("../public/teras-universal-logo.png", import.meta.url))).toString("base64");
    const qrData = Buffer.from(await readFile(new URL("../public/documents/payment/teras-universal-duitnow-qr-code.png", import.meta.url))).toString("base64");
    assert.ok(logoData.length > 0, "official TERAS logo asset must be loaded for Invoice fixtures");
    const quotationPath = join(workspace, "quotation-stress.pdf");
    const invoicePath = join(workspace, "invoice-stress.pdf");
    const stagingReceiptPath = join(workspace, "receipt-staging-e2e.pdf");
    const invoiceQrNormalPath = join(workspace, "invoice-payment-qr-normal.pdf");
    const invoiceQrMultipagePath = join(workspace, "invoice-payment-qr-multipage.pdf");
    const receiptPaths = ["receipt-partial-payment.pdf", "receipt-paid-in-full.pdf", "receipt-long-content.pdf", "receipt-multipage.pdf", "receipt-refunded.pdf"].map((name) => join(workspace, name));
    await renderPdf(browser, quotationHtml(), quotationPath);
    await renderPdf(browser, invoiceHtml(logoData), invoicePath);
    await renderPdf(browser, receiptHtml("partial", logoData), receiptPaths[0]);
    await renderPdf(browser, receiptHtml("paid", logoData), receiptPaths[1]);
    await renderPdf(browser, receiptHtml("long", logoData), receiptPaths[2]);
    await renderPdf(browser, receiptHtml("multipage", logoData), receiptPaths[3]);
    await renderPdf(browser, receiptHtml("refunded", logoData), receiptPaths[4]);
    await renderPdf(browser, stagingReceiptHtml(logoData), stagingReceiptPath);
    await renderPdf(browser, invoicePaymentInstructionsHtml(qrData, false, logoData), invoiceQrNormalPath);
    await renderPdf(browser, invoicePaymentInstructionsHtml(qrData, true, logoData), invoiceQrMultipagePath);
    if (reviewArtifactDir) {
      await writeFile(join(reviewArtifactDir, "receipt-partial-payment.pdf"), await readFile(receiptPaths[0]));
      await writeFile(join(reviewArtifactDir, "receipt-paid-in-full.pdf"), await readFile(receiptPaths[1]));
      await writeFile(join(reviewArtifactDir, "receipt-long-content.pdf"), await readFile(receiptPaths[2]));
      await writeFile(join(reviewArtifactDir, "receipt-multipage.pdf"), await readFile(receiptPaths[3]));
      await writeFile(join(reviewArtifactDir, "receipt-refunded.pdf"), await readFile(receiptPaths[4]));
      await writeFile(join(reviewArtifactDir, "receipt-staging-e2e.pdf"), await readFile(stagingReceiptPath));
      await writeFile(join(reviewArtifactDir, "invoice-payment-qr-normal.pdf"), await readFile(invoiceQrNormalPath));
      await writeFile(join(reviewArtifactDir, "invoice-payment-qr-multipage.pdf"), await readFile(invoiceQrMultipagePath));
      await renderPng(browser, invoicePaymentInstructionsHtml(qrData, false, logoData), join(reviewArtifactDir, "invoice-payment-qr-normal-page1.png"));
      await renderPagePng(browser, invoicePaymentInstructionsHtml(qrData, true, logoData), join(reviewArtifactDir, "invoice-payment-qr-final-page.png"), 2);
      await renderPng(browser, receiptHtml("partial", logoData), join(reviewArtifactDir, "receipt-partial-payment-page1.png"));
      await renderPng(browser, receiptHtml("paid", logoData), join(reviewArtifactDir, "receipt-paid-in-full-page1.png"));
      await renderPng(browser, receiptHtml("long", logoData), join(reviewArtifactDir, "receipt-long-content-page1.png"));
      await renderPng(browser, receiptHtml("refunded", logoData), join(reviewArtifactDir, "receipt-refunded-page1.png"));
      await renderPng(browser, stagingReceiptHtml(logoData), join(reviewArtifactDir, "receipt-staging-e2e-page1.png"));
    }

    const quotationPages = await extractPages(quotationPath);
    const invoicePages = await extractPages(invoicePath);
    assertLabels(quotationPages, 4);
    assertLabels(invoicePages, 3);
    assertItemsExactlyOnce(quotationPages.join("\n"), "Module", 1, 18);
    assertItemsExactlyOnce(invoicePages.join("\n"), "Invoice Item", 1, 30);
    assert.ok(quotationPages.join("\n").includes("Long terms and notes preserved exactly."));
    assert.ok(invoicePages.join("\n").includes("Balance Due"));
    assert.ok(!quotationPages.join("\n").includes("DuitNow QR"), "Quotation must not contain payment QR content");

    const partialPages = await extractPages(receiptPaths[0]);
    const paidPages = await extractPages(receiptPaths[1]);
    const longPages = await extractPages(receiptPaths[2]);
    const multipagePages = await extractPages(receiptPaths[3]);
    const refundedPages = await extractPages(receiptPaths[4]);
    const invoiceQrBaselinePath = join(workspace, "invoice-qr-baseline.pdf");
    await renderPdf(browser, invoiceHtml(logoData), invoiceQrBaselinePath);
    await assertStagingReceiptPdf(stagingReceiptPath);
    await assertInvoicePaymentQrPdf(invoiceQrNormalPath, 1, invoiceQrBaselinePath);
    await assertInvoicePaymentQrPdf(invoiceQrMultipagePath, 3, invoiceQrBaselinePath);
    assertLabels(partialPages, 1);
    assertLabels(paidPages, 1);
    assertLabels(longPages, longPages.length);
    assertLabels(multipagePages, multipagePages.length);
    assertLabels(refundedPages, 1);
    assert.match(partialPages.join("\n"), /A\s*M\s*O\s*U\s*N\s*T\s+R\s*E\s*C\s*E\s*I\s*V\s*E\s*D/);
    assert.ok(partialPages.join("\n").includes("TERAS UNIVERSAL SDN. BHD."));
    assert.ok(partialPages.join("\n").includes("201201003207 (976732-P)"));
    assert.ok(partialPages.join("\n").includes("06000 Jitra, Kedah."));
    assert.ok(partialPages.join("\n").includes("RCPT-2026-0001"));
    assert.ok(partialPages.join("\n").includes("INV-2026-0003"));
    assert.ok(partialPages.join("\n").includes("RM 3,850.00"));
    assert.ok(!partialPages.join("\n").includes("DuitNow QR"), "Receipt must not contain payment QR content");
    assert.ok(paidPages.join("\n").includes("PAID IN FULL"));
    assert.ok(paidPages.join("\n").includes("RM 0.00"));
    assert.match(refundedPages.join("\n"), /R\s*E\s*F\s*U\s*N\s*D\s*E\s*D\s+R\s*E\s*C\s*E\s*I\s*P\s*T/);
    assert.ok(!refundedPages.join("\n").includes("VOIDED RECEIPT"));
    assert.ok(longPages.join("\n").includes("PAYMENT-REFERENCE-"));
    const longNoteBlocks = splitReceiptNotes(notesForContract("long"), 55);
    const observedLongBlocks = longNoteBlocks.filter((block) => longPages.some((page) => page.replace(/\s+/g, " ").includes(block.replace(/\s+/g, " "))));
    assert.deepEqual(observedLongBlocks, longNoteBlocks);
    assert.ok(multipagePages.length > 1);
    assert.notDeepEqual(multipagePages, longPages);
  } finally {
    await browser.close();
    await rm(workspace, { recursive: true, force: true });
  }
}

main().then(() => {
  console.log("Document System V1 PDF visual contract: PASS (self-contained generated fixtures)");
}).catch((error) => {
  console.error(`Document System V1 PDF visual contract: FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
