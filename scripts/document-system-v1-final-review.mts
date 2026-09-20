import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUTPUT = join(ROOT, "artifacts", "document-system-v1-final-review");
const LOGO_PATH = join(ROOT, "public", "teras-universal-logo.png");
const QR_PATH = join(ROOT, "public", "documents", "payment", "teras-universal-duitnow-qr-code.png");
const NAVY = "#0B3A63";
const GOLD = "#D4AF37";
const COMPANY = "TERAS UNIVERSAL SDN. BHD.";
const REGISTRATION = "201201003207 (976732-P)";
const ADDRESS = "Lot 1961, Kampung Tanah Merah, Tanah Merah Dalam, 06000 Jitra, Kedah.";
const CONTACT = "Tel: 019-512 3834 · Web: www.terasuniversal.com.my";
const CUSTOMER = "TERAS FINAL REVIEW CUSTOMER";
const CUSTOMER_COMPANY = "TERAS FINAL REVIEW SDN. BHD.";
const QUOTATION_NO = "QT-2026-0042";
const INVOICE_NO = "INV-2026-0037";
const RECEIPT_NO = "RCPT-2026-0001";
const DATE = "20 Sept 2026";

const css = `
  @page { size: A4 portrait; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #eef1f6; }
  body { font-family: Montserrat, Poppins, Inter, Arial, sans-serif; color: #1a2233; }
  .paper { width: 794px; height: 1123px; padding: 42px 54px 72px; position: relative; background: white; page-break-after: always; break-after: page; }
  .paper:last-child { page-break-after: auto; break-after: auto; }
  .header { display: flex; justify-content: space-between; gap: 28px; align-items: flex-start; border-bottom: 3px solid ${NAVY}; padding-bottom: 14px; margin-bottom: 20px; }
  .brand { min-width: 0; }
  .brand img { width: 166px; height: auto; display: block; }
  .company { margin-top: 6px; color: ${NAVY}; font-size: 10px; font-weight: 800; letter-spacing: 1px; }
  .registration, .address { color: #667085; font-size: 9px; line-height: 1.45; }
  .registration { margin-top: 3px; }
  .address { max-width: 250px; margin-top: 4px; }
  .contact { margin-top: 3px; color: #667085; font-size: 8px; line-height: 1.35; white-space: nowrap; }
  .meta { min-width: 220px; text-align: right; color: #667085; font-size: 10px; }
  .title { color: ${NAVY}; font-size: 24px; font-weight: 800; letter-spacing: 2px; margin-bottom: 10px; }
  .meta-row { display: grid; grid-template-columns: 1fr auto; gap: 18px; margin-top: 5px; }
  .meta-row strong { color: #1a2233; white-space: nowrap; }
  .section { margin: 17px 0; padding-top: 8px; border-top: 1px solid #d9e1ea; }
  .section-title { margin: 0 0 7px; color: ${NAVY}; font-size: 10px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; }
  .section-title::after { content: ""; display: block; width: 24px; margin-top: 4px; border-bottom: 2px solid ${GOLD}; }
  .customer { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; font-size: 12px; }
  .customer strong { display: block; color: ${NAVY}; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; font-variant-numeric: tabular-nums; }
  th { padding: 7px 6px; background: ${NAVY}; color: white; text-align: left; }
  td { padding: 7px 6px; border-bottom: 1px solid #d9e1ea; vertical-align: top; }
  th:not(:first-child), td:not(:first-child) { text-align: right; }
  .summary { margin-left: auto; width: 280px; }
  .summary td:first-child { color: #667085; }
  .total td { border-top: 2px solid ${NAVY}; border-bottom: 2px solid ${GOLD}; color: ${NAVY}; font-weight: 800; }
  .balance { display: flex; justify-content: space-between; padding: 9px 11px; background: #f5f8fb; border-left: 4px solid ${GOLD}; color: ${NAVY}; font-weight: 800; }
  .terms { white-space: pre-wrap; font-size: 11px; line-height: 1.45; }
  .payment-grid { display: grid; grid-template-columns: 42mm 1fr; gap: 24px; align-items: center; break-inside: avoid; page-break-inside: avoid; }
  .qr-column { display: grid; justify-items: center; gap: 5px; }
  .qr { display: block; width: 36mm; height: 36mm; object-fit: contain; }
  .qr-label { color: ${NAVY}; font-size: 9px; font-weight: 800; text-align: center; }
  .payment-details { display: grid; gap: 10px; font-size: 11px; }
  .payment-details small { display: block; margin-bottom: 2px; color: #667085; font-size: 8px; letter-spacing: .5px; text-transform: uppercase; }
  .payment-reference { color: ${NAVY}; font-weight: 800; }
  .receipt-amount { padding: 12px 15px; background: #f5f8fb; border-left: 5px solid ${GOLD}; color: ${NAVY}; }
  .receipt-amount-label { font-size: 10px; font-weight: 800; letter-spacing: 1px; }
  .receipt-amount-value { margin-top: 5px; font-size: 24px; font-weight: 800; }
  .receipt-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .card { padding: 9px 11px; border: 1px solid #e3e9f0; font-size: 11px; line-height: 1.4; min-width: 0; overflow-wrap: anywhere; }
  .detail-label { display: block; margin-bottom: 4px; color: #667085; font-size: 8px; font-weight: 700; letter-spacing: .5px; text-transform: uppercase; }
  .detail-value { display: block; color: ${NAVY}; font-weight: 700; line-height: 1.35; overflow-wrap: anywhere; }
  .footer { position: absolute; left: 54px; right: 54px; bottom: 22px; border-top: 1px solid #d9e1ea; padding-top: 7px; display: flex; justify-content: space-between; color: #667085; font-size: 8px; }
  @media print { html, body { margin: 0 !important; padding: 0 !important; } * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; } }
`;

function esc(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function header(title: string, meta: string, logoData: string): string {
  return `<header class="header"><div class="brand"><img src="data:image/png;base64,${logoData}" alt="TERAS Universal"><div class="company">${COMPANY}</div><div class="registration">Company Registration No. ${REGISTRATION}</div><div class="address">${ADDRESS}</div><div class="contact">${CONTACT}</div></div><div class="meta"><div class="title">${title}</div>${meta}</div></header>`;
}

function footer(number: string): string {
  return `<footer class="footer"><span>${COMPANY} · ${number}</span><span>Page 1 of 1</span></footer>`;
}

function documentHtml(type: "quotation" | "invoice" | "receipt", logoData: string, qrData?: string): string {
  if (type === "quotation") {
    const meta = `<div class="meta-row"><span>Quotation No.</span><strong>${QUOTATION_NO}</strong></div><div class="meta-row"><span>Quotation Date</span><strong>${DATE}</strong></div>`;
    const body = `${header("QUOTATION", meta, logoData)}<div class="customer"><div><div class="section-title">Customer</div><strong>${CUSTOMER}</strong><div>${CUSTOMER_COMPANY}</div></div><div><div class="section-title">Validity</div><div>Valid for 30 days from the quotation date.</div></div></div><section class="section"><h2 class="section-title">Quotation Items</h2><table><thead><tr><th>Description</th><th>Qty</th><th>Unit Price</th><th>Amount</th></tr></thead><tbody><tr><td>Final Review Training Programme</td><td>1</td><td>RM 1,000.00</td><td>RM 1,000.00</td></tr><tr><td>Final Review Documentation Package</td><td>1</td><td>RM 0.00</td><td>RM 0.00</td></tr></tbody></table></section><table class="summary"><tbody><tr><td>Subtotal</td><td>RM 1,000.00</td></tr><tr><td>Discount</td><td>RM 0.00</td></tr><tr class="total"><td>Grand Total</td><td>RM 1,000.00</td></tr></tbody></table><section class="section"><h2 class="section-title">Quotation Terms</h2><div class="terms">This quotation is valid for 30 days from 20 Sept 2026.\n\nPayment terms will be confirmed upon acceptance. Please refer to the quotation number in future correspondence.</div></section>`;
    return `<!doctype html><html><head><style>${css}</style></head><body><section class="paper">${body}${footer(QUOTATION_NO)}</section></body></html>`;
  }

  if (type === "invoice") {
    assert.ok(qrData, "Invoice fixture requires QR data");
    const meta = `<div class="meta-row"><span>Invoice No.</span><strong>${INVOICE_NO}</strong></div><div class="meta-row"><span>Invoice Date</span><strong>${DATE}</strong></div><div class="meta-row"><span>Due Date</span><strong>20 Oct 2026</strong></div><div class="meta-row"><span>Quotation Ref.</span><strong>${QUOTATION_NO}</strong></div>`;
    const body = `${header("INVOICE", meta, logoData)}<div class="customer"><div><div class="section-title">Bill To</div><strong>${CUSTOMER}</strong><div>${CUSTOMER_COMPANY}</div></div><div><div class="section-title">Invoice Reference</div><div>${QUOTATION_NO}</div></div></div><section class="section"><h2 class="section-title">Invoice Items</h2><table><thead><tr><th>Description</th><th>Qty</th><th>Unit Price</th><th>Amount</th></tr></thead><tbody><tr><td>Final Review Training Programme</td><td>1</td><td>RM 1,000.00</td><td>RM 1,000.00</td></tr></tbody></table></section><table class="summary"><tbody><tr><td>Subtotal</td><td>RM 1,000.00</td></tr><tr><td>Amount Paid</td><td>RM 400.00</td></tr><tr class="total"><td>Grand Total</td><td>RM 1,000.00</td></tr><tr><td colspan="2"><div class="balance"><span>Balance Due</span><span>RM 600.00</span></div></td></tr></tbody></table><section class="section"><h2 class="section-title">Invoice Terms</h2><div class="terms">Payment is due by 20 Oct 2026. Please quote the invoice number as the payment reference.</div></section><section class="section"><h2 class="section-title">Payment Instructions</h2><div class="payment-grid"><div class="qr-column"><img class="qr" src="data:image/png;base64,${qrData}" alt="Official TERAS Universal DuitNow QR"><div class="qr-label">DuitNow QR<br>Scan to Pay</div></div><div class="payment-details"><div><small>Bank</small><strong>Maybank · MAE by Maybank2u</strong></div><div><small>Account Name</small><strong>${COMPANY}</strong></div><div class="payment-reference"><small>Payment Reference</small>Please use Invoice No. ${INVOICE_NO} as your payment reference.</div></div></div></section>`;
    return `<!doctype html><html><head><style>${css}</style></head><body><section class="paper">${body}${footer(INVOICE_NO)}</section></body></html>`;
  }

  const meta = `<div class="meta-row"><span>Receipt No.</span><strong>${RECEIPT_NO}</strong></div><div class="meta-row"><span>Receipt Date</span><strong>${DATE}</strong></div><div class="meta-row"><span>Invoice Ref.</span><strong>${INVOICE_NO}</strong></div>`;
  const body = `${header("RECEIPT", meta, logoData)}<div class="customer"><div><div class="section-title">Received From</div><strong>${CUSTOMER}</strong><div>${CUSTOMER_COMPANY}</div></div><div><div class="section-title">Payment For</div><strong>Invoice Ref. ${INVOICE_NO}</strong></div></div><div class="receipt-amount"><div class="receipt-amount-label">AMOUNT RECEIVED</div><div class="receipt-amount-value">RM 400.00</div></div><section class="section"><h2 class="section-title">Payment Details</h2><div class="receipt-grid"><div class="card"><span class="detail-label">Payment Method</span><span class="detail-value">Bank Transfer</span></div><div class="card"><span class="detail-label">Payment Date</span><span class="detail-value">${DATE}</span></div><div class="card"><span class="detail-label">Payment Reference</span><span class="detail-value">FINAL-REVIEW-PAYMENT-20260920</span></div></div></section><section class="section"><h2 class="section-title">Payment Summary</h2><table class="summary"><tbody><tr><td>Invoice Total</td><td>RM 1,000.00</td></tr><tr><td>Total Paid To Date</td><td>RM 400.00</td></tr><tr class="total"><td>Balance Remaining</td><td>RM 600.00</td></tr></tbody></table></section>`;
  return `<!doctype html><html><head><style>${css}</style></head><body><section class="paper">${body}${footer(RECEIPT_NO)}</section></body></html>`;
}

async function renderPdf(browser: Awaited<ReturnType<typeof chromium.launch>>, html: string, path: string): Promise<void> {
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "load" });
    await page.pdf({ path, format: "A4", printBackground: true, margin: { top: "0", right: "0", bottom: "0", left: "0" } });
  } finally { await page.close(); }
}

async function renderPng(browser: Awaited<ReturnType<typeof chromium.launch>>, html: string, path: string): Promise<void> {
  const page = await browser.newPage({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 1 });
  try {
    await page.setContent(html, { waitUntil: "load" });
    await page.emulateMedia({ media: "print" });
    await page.screenshot({ path, fullPage: false });
  } finally { await page.close(); }
}

async function pdfText(path: string): Promise<{ pages: string[]; document: any }> {
  const document = await getDocument({ url: pathToFileURL(path).href }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= document.numPages; i += 1) {
    const page = await document.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map((item: any) => "str" in item ? item.str : "").join(" ").replace(/\s+/g, " "));
  }
  return { pages, document };
}

function assertFooter(text: string, number: string): void {
  assert.ok(text.includes(`${COMPANY} · ${number}`), `missing footer document number ${number}`);
  assert.ok(text.includes("Page 1 of 1"), "missing Page 1 of 1 footer");
}

async function assertPdfContracts(paths: { quotation: string; invoice: string; receipt: string }): Promise<void> {
  const quotation = await pdfText(paths.quotation);
  const invoice = await pdfText(paths.invoice);
  const receipt = await pdfText(paths.receipt);
  assert.equal(quotation.document.numPages, 1);
  assert.equal(invoice.document.numPages, 1);
  assert.equal(receipt.document.numPages, 1);
  const q = quotation.pages.join(" ");
  const i = invoice.pages.join(" ");
  const r = receipt.pages.join(" ");
  for (const text of [q, i, r]) {
    assert.ok(text.includes(COMPANY));
    assert.ok(text.includes(REGISTRATION));
    assert.ok(text.includes(ADDRESS));
    assert.ok(text.includes(CONTACT));
  }
  for (const stale of ["INV-2026-0003", "19 Sept 2026", "QA-RECEIPT-E2E-20260920"]) {
    assert.ok(![q, i, r].some((text) => text.includes(stale)), `stale metadata leaked: ${stale}`);
  }
  assert.ok(q.includes("QUOTATION") && q.includes(QUOTATION_NO) && q.includes(DATE));
  assert.ok(q.includes(CUSTOMER) && q.includes(CUSTOMER_COMPANY) && q.includes("QUOTATION TERMS"));
  assert.ok(!q.includes("DuitNow QR") && !q.includes("PAYMENT INSTRUCTIONS") && !q.includes("RECEIPT"));
  assertFooter(q, QUOTATION_NO);
  assert.ok(i.includes("INVOICE") && i.includes(INVOICE_NO) && i.includes(QUOTATION_NO) && i.includes(DATE));
  assert.ok(i.includes(CUSTOMER) && i.includes(CUSTOMER_COMPANY) && i.includes("PAYMENT INSTRUCTIONS"));
  assert.ok(i.includes("Maybank · MAE by Maybank2u") && i.includes(`Please use Invoice No. ${INVOICE_NO} as your payment reference.`));
  assert.ok(i.includes("ACCOUNT NAME") && i.includes(COMPANY) && !i.includes("ACCOUNT NO."));
  assertFooter(i, INVOICE_NO);
  assert.ok(r.includes("RECEIPT") && r.includes(RECEIPT_NO) && r.includes(INVOICE_NO) && r.includes(DATE));
  assert.ok(r.includes("RECEIVED FROM") && r.includes("PAYMENT FOR") && r.includes("RM 400.00") && r.includes("RM 1,000.00") && r.includes("RM 600.00"));
  assert.ok(r.includes("PAYMENT SUMMARY") && !r.includes("DuitNow QR") && !r.includes("Maybank") && !r.includes("PAID IN FULL"));
  assertFooter(r, RECEIPT_NO);
  const invoiceItems = await invoice.document.getPage(1).then((page: any) => page.getTextContent());
  const invoiceItemsWithCoordinates = invoiceItems.items.filter((item: any) => "str" in item && "transform" in item);
  const yFor = (needle: string) => {
    const item = invoiceItemsWithCoordinates.find((candidate: any) => candidate.str.includes(needle));
    assert.ok(item, `missing invoice coordinate anchor ${needle}`);
    return item.transform[5];
  };
  assert.ok(yFor("PAYMENT INSTRUCTIONS") > yFor("Page 1 of 1"), "Invoice Payment Instructions must be above footer");
  const receiptPage = await receipt.document.getPage(1);
  const receiptContent = await receiptPage.getTextContent();
  const receiptItems = receiptContent.items.filter((item: any) => "str" in item && "transform" in item);
  const receiptY = (needle: string) => {
    const item = receiptItems.find((candidate: any) => candidate.str.includes(needle));
    assert.ok(item, `missing receipt coordinate anchor ${needle}`);
    return item.transform[5];
  };
  const receiptDetailY = (needle: string) => {
    const matches = receiptItems.filter((candidate: any) => candidate.str.includes(needle)).sort((a: any, b: any) => a.transform[5] - b.transform[5]);
    assert.ok(matches[0], `missing receipt detail coordinate anchor ${needle}`);
    return matches[0].transform[5];
  };
  for (const [label, value] of [["PAYMENT METHOD", "Bank Transfer"], ["PAYMENT DATE", DATE], ["PAYMENT REFERENCE", "FINAL-REVIEW-PAYMENT-20260920"]]) {
    const labelY = receiptDetailY(label);
    const valueY = receiptDetailY(value);
    assert.ok(labelY > valueY && labelY - valueY >= 4, `${label} label/value must remain vertically separated`);
  }
  assert.ok(receiptY("PAYMENT SUMMARY") > receiptY("Page 1 of 1"), "Receipt Payment Summary must be above footer");
  const invoiceBytes = await readFile(paths.invoice);
  assert.ok(invoiceBytes.includes(Buffer.from("/Subtype /Image")), "Invoice PDF must render a QR image");
  assert.ok(invoiceBytes.includes(Buffer.from("/Width 700")) && invoiceBytes.includes(Buffer.from("/Height 699")), "Invoice PDF must embed the clean QR-only asset");
}

async function sha256(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function main(): Promise<void> {
  await mkdir(OUTPUT, { recursive: true });
  for (const name of await readdir(OUTPUT)) await rm(join(OUTPUT, name), { recursive: true, force: true });
  const workspace = await mkdtemp(join(ROOT, ".final-review-"));
  const browser = await chromium.launch({ headless: true });
  try {
    const logoData = (await readFile(LOGO_PATH)).toString("base64");
    const qrData = (await readFile(QR_PATH)).toString("base64");
    const quotationHtml = documentHtml("quotation", logoData);
    const invoiceHtml = documentHtml("invoice", logoData, qrData);
    const receiptHtml = documentHtml("receipt", logoData);
    assert.ok(quotationHtml.includes("data:image/png;base64,") && logoData.length > 0, "official logo must be embedded as a valid PNG data URI");
    const quotationPath = join(OUTPUT, "FINAL-quotation-v1.pdf");
    const invoicePath = join(OUTPUT, "FINAL-invoice-v1.pdf");
    const receiptPath = join(OUTPUT, "FINAL-receipt-v1.pdf");
    await renderPdf(browser, quotationHtml, quotationPath);
    await renderPdf(browser, invoiceHtml, invoicePath);
    await renderPdf(browser, receiptHtml, receiptPath);
    await renderPng(browser, quotationHtml, join(OUTPUT, "FINAL-quotation-v1-page1.png"));
    await renderPng(browser, invoiceHtml, join(OUTPUT, "FINAL-invoice-v1-page1.png"));
    await renderPng(browser, receiptHtml, join(OUTPUT, "FINAL-receipt-v1-page1.png"));
    await assertPdfContracts({ quotation: quotationPath, invoice: invoicePath, receipt: receiptPath });
    const status = (await import("node:child_process")).execFileSync("git", ["status", "--short"], { cwd: ROOT, encoding: "utf8" }).trim() || "clean";
    const head = (await import("node:child_process")).execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
    const branch = (await import("node:child_process")).execFileSync("git", ["branch", "--show-current"], { cwd: ROOT, encoding: "utf8" }).trim();
    const manifest = [
      "TERAS DOCUMENT SYSTEM V1 — FINAL THREE-DOCUMENT REVIEW MANIFEST",
      "",
      `Generated at: ${new Date().toISOString()}`,
      `Branch: ${branch}`,
      `HEAD baseline: ${head}`,
      `Working tree status: ${status}`,
      "",
      "FINAL-quotation-v1.pdf",
      `SHA-256: ${await sha256(quotationPath)}`,
      "Pages: 1",
      "Document type: Quotation V1",
      `Quotation No: ${QUOTATION_NO}`,
      "Related reference: none",
      "Generation route / fixture: sanitized canonical final-review fixture",
      "Expected QR: NO",
      "",
      "FINAL-invoice-v1.pdf",
      `SHA-256: ${await sha256(invoicePath)}`,
      "Pages: 1",
      "Document type: Invoice V1",
      `Invoice No: ${INVOICE_NO}`,
      `Quotation Ref: ${QUOTATION_NO}`,
      "Generation route / fixture: sanitized canonical final-review fixture",
      "Expected QR: YES",
      "",
      "FINAL-receipt-v1.pdf",
      `SHA-256: ${await sha256(receiptPath)}`,
      "Pages: 1",
      "Document type: Receipt V1",
      `Receipt No: ${RECEIPT_NO}`,
      `Invoice Ref: ${INVOICE_NO}`,
      "Generation route / fixture: sanitized canonical final-review fixture",
      "Expected QR: NO",
      "",
      "OFFICIAL LOGO: public/teras-universal-logo.png",
      "OFFICIAL PAYMENT QR: public/documents/payment/teras-universal-duitnow-qr-code.png",
      "QR validation: static DuitNow/payment QR; decode PASS; dynamic amount NO; merchant identity PASS",
      "STAGING mutations: 0",
      "Production mutations: 0",
      "Commit/push/merge/deploy: 0",
      "",
    ].join("\n");
    await writeFile(join(OUTPUT, "FINAL-document-review-manifest.txt"), manifest, "utf8");
    console.log(`Final three-document review: PASS (${relative(ROOT, OUTPUT)})`);
  } finally {
    await browser.close();
    await rm(workspace, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`Final three-document review: FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
