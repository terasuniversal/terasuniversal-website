import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
  .items { width: 100%; border-collapse: collapse; margin-top: 8mm; font-size: 10px; }
  .items th { background: #0b3a63; color: white; text-align: left; padding: 5px; }
  .items td { border-bottom: 1px solid #d9e1ea; padding: 5px; vertical-align: top; }
  .footer { position: absolute; left: 14mm; right: 14mm; bottom: 8mm; border-top: 1px solid #d9e1ea; padding-top: 3mm; font-size: 8px; display: flex; justify-content: space-between; }
  .long { white-space: pre-wrap; overflow-wrap: anywhere; }
`;

function page(title: string, pageNumber: number, pageCount: number, body: string): string {
  return `<section class="paper"><header class="header"><div>TERAS UNIVERSAL SDN. BHD.</div><div class="title">${title}</div></header>${body}<footer class="footer"><span>TERAS UNIVERSAL SDN. BHD.</span><span>Page ${pageNumber} of ${pageCount}</span></footer></section>`;
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

function invoiceHtml(): string {
  const pages = [
    page("INVOICE", 1, 3, `<p>Bill To: Long Billing Company<br>${"Long billing address line. ".repeat(18)}</p>${itemTable("Invoice Item", 1, 11, true)}`),
    page("INVOICE — Continued", 2, 3, itemTable("Invoice Item", 12, 11)),
    page("INVOICE — Continued", 3, 3, `${itemTable("Invoice Item", 23, 8)}<p class="long">Payment terms: ${"Payment reference and settlement terms preserved. ".repeat(24)}</p><p>Grand Total RM 3,900.00</p><p>Amount Paid RM 1,000.00</p><p>Balance Due RM 2,900.00</p>`),
  ];
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

async function main(): Promise<void> {
  const workspace = await mkdtemp(join(tmpdir(), "teras-document-system-v1-"));
  const browser = await chromium.launch({ headless: true });
  try {
    const quotationPath = join(workspace, "quotation-stress.pdf");
    const invoicePath = join(workspace, "invoice-stress.pdf");
    await renderPdf(browser, quotationHtml(), quotationPath);
    await renderPdf(browser, invoiceHtml(), invoicePath);

    const quotationPages = await extractPages(quotationPath);
    const invoicePages = await extractPages(invoicePath);
    assertLabels(quotationPages, 4);
    assertLabels(invoicePages, 3);
    assertItemsExactlyOnce(quotationPages.join("\n"), "Module", 1, 18);
    assertItemsExactlyOnce(invoicePages.join("\n"), "Invoice Item", 1, 30);
    assert.ok(quotationPages.join("\n").includes("Long terms and notes preserved exactly."));
    assert.ok(invoicePages.join("\n").includes("Balance Due"));
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
