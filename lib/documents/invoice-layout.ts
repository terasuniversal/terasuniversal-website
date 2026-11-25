import { estimateTextLines } from "./pagination";

/**
 * DOC-3: A4 invoice pagination that matches the printed sheets.
 *
 * The previous packer under-estimated every block (68 characters at 14px per
 * line for a 315px column that fits ~40 characters at ~19px), ignored the
 * Bill To block entirely, and treated totals + payments + terms + payment
 * instructions + notes as one unsplittable block. Each paper then grew past
 * 297mm and Chromium printed 7 sheets for a 4-page invoice.
 *
 * This layout keeps the same deterministic, server-side model (no browser
 * measurement), but:
 *   - the invoice page CSS sets explicit line-heights, so lines x line-height
 *     is exact and only characters-per-line is estimated;
 *   - characters-per-line are deliberately conservative (wide glyphs), so an
 *     estimate can only over-count and push content to a further page, never
 *     overflow the paper;
 *   - heights are calibrated against the on-screen layout, which is the larger
 *     of screen and print (header 248 vs 199px, section margins 22 vs 11px),
 *     so a paper that fits on screen also fits the printed sheet;
 *   - the first page budget subtracts the real header and Bill To heights;
 *   - the closing content is split into ordered blocks (totals, payments,
 *     terms, payment instructions, notes), and long terms/notes/Bill To are
 *     split by line, so nothing larger than a page is ever required to fit.
 * A runtime check in DocumentPrintController still refuses to auto-print a
 * paper that overflows, as a safety net for anything this model misses.
 */

/** A4 at 96 CSS px/in: 794 x 1123. Paper padding 48 top / 72 bottom (running footer lives in the bottom padding). */
export const INVOICE_PAPER = { height: 1123, paddingTop: 48, paddingBottom: 72 } as const;
const CONTENT_HEIGHT = INVOICE_PAPER.height - INVOICE_PAPER.paddingTop - INVOICE_PAPER.paddingBottom; // 1003
/** Head-room kept free on every paper for font/rounding differences between estimate and render. */
export const INVOICE_SAFETY_MARGIN = 40;

/** Line-heights the invoice CSS sets explicitly (keep in sync with app/admin/invoice-pdf/[id]/page.tsx). */
export const INVOICE_LINE = { item: 18, itemPackage: 16, billTo: 18, terms: 17, notes: 16 } as const;
/** Conservative characters per line for each text column at its font size. */
export const INVOICE_CPL = { item: 34, itemPackage: 40, billTo: 32, terms: 72, notes: 76 } as const;

const HEADER_HEIGHT = 248 + 24; // document header (screen) + its margin
const CONTINUATION_HEADER_HEIGHT = 63 + 18;
const TABLE_OVERHEAD = 35 + 16; // thead + table margin, once per paper that has item rows
const BILL_TO_LABEL = 18 + 4; // "Bill To" label line + margin
const BILL_TO_MARGIN = 24;
const TRAINING_SECTION = 44 + 170; // section margins + content
const TOTALS_BASE = 175 + 24; // subtotal, discount, grand total, amount paid, balance + margin
const TOTALS_TAX_ROW = 24;
const PAYMENTS_HEAD = 23 + 20;
const PAYMENTS_ROW = 26;
const SECTION_CHROME = 22 + 22 + 10 + 1 + 16 + 8; // margins, padding, border, title + its margin
const PAYMENT_INSTRUCTIONS = 22 + 22 + 200; // measured 195 on screen
const NOTES_TOP = 16;

export interface InvoiceLayoutItem {
  id: string;
  course_name_snapshot?: string | null;
  description?: string | null;
  package_includes_snapshot?: Array<{ label?: unknown }> | null;
}
export interface InvoiceLayoutInput<T extends InvoiceLayoutItem> {
  items: T[];
  billTo: Array<string | null | undefined>;
  hasTraining: boolean;
  showTax: boolean;
  paymentCount: number;
  /** Fixed terms line(s) plus optional free-text payment terms. */
  termsText: string;
  notes: string | null | undefined;
}

export type InvoiceFinalBlock =
  | { kind: "totals" }
  | { kind: "payments" }
  | { kind: "terms"; lines: string[]; first: boolean }
  | { kind: "paymentInstructions" }
  | { kind: "notes"; lines: string[] };

/**
 * "full" renders the normal Bill To block. A Bill To too tall for page 1 (fields at their length limits) is
 * flowed as wrapped lines instead, continuing on the next paper(s) before the item table.
 */
export type InvoiceBillToBlock = { mode: "full" } | { mode: "lines"; lines: string[]; first: boolean };

export interface InvoicePageLayout<T> {
  items: T[];
  final: InvoiceFinalBlock[];
  billTo?: InvoiceBillToBlock;
  training?: boolean;
}

export function invoiceItemHeight(item: InvoiceLayoutItem): number {
  const name = item.course_name_snapshot?.trim() ? estimateTextLines(item.course_name_snapshot, INVOICE_CPL.item) : 0;
  const description = estimateTextLines(item.description ?? "", INVOICE_CPL.item);
  const packageLabels = (item.package_includes_snapshot ?? []).map((entry) => String(entry?.label ?? "")).filter(Boolean);
  const pkg = packageLabels.length > 0 ? 4 + estimateTextLines(`Package includes: ${packageLabels.join(" · ")}`, INVOICE_CPL.itemPackage) * INVOICE_LINE.itemPackage : 0;
  return 16 + 1 + (name + description) * INVOICE_LINE.item + pkg;
}

function billToFields(lines: Array<string | null | undefined>): string[] {
  return lines.map((line) => String(line ?? "").trim()).filter(Boolean);
}

export function billToHeight(lines: Array<string | null | undefined>): number {
  const count = billToFields(lines).reduce((sum, line) => sum + estimateTextLines(line, INVOICE_CPL.billTo), 0);
  return BILL_TO_LABEL + count * INVOICE_LINE.billTo + 6 + BILL_TO_MARGIN; // 6: training-address top margin
}

/** Wrap free text into display lines at a conservative width so long text can flow across papers. */
export function wrapLines(text: string, charactersPerLine: number): string[] {
  const out: string[] = [];
  for (const paragraph of String(text ?? "").split(/\r?\n/)) {
    if (paragraph.length === 0) { out.push(""); continue; }
    let rest = paragraph;
    while (rest.length > charactersPerLine) {
      let cut = rest.lastIndexOf(" ", charactersPerLine);
      if (cut <= 0) cut = charactersPerLine;
      out.push(rest.slice(0, cut));
      rest = rest.slice(cut).replace(/^ /, "");
    }
    out.push(rest);
  }
  return out;
}

/** Space for content on a paper, excluding its header. */
export function pageCapacity(pageIndex: number): number {
  return CONTENT_HEIGHT - (pageIndex === 0 ? HEADER_HEIGHT : CONTINUATION_HEADER_HEIGHT) - INVOICE_SAFETY_MARGIN;
}
/** Space left for items and closing blocks on page 1 when the Bill To block is rendered whole. */
export function firstPageCapacity(input: { billTo: Array<string | null | undefined>; hasTraining: boolean }): number {
  return pageCapacity(0) - billToHeight(input.billTo) - (input.hasTraining ? TRAINING_SECTION : 0);
}
export const CONTINUATION_CAPACITY = pageCapacity(1);

export function finalBlockHeight(block: InvoiceFinalBlock, input: { showTax: boolean; paymentCount: number }): number {
  switch (block.kind) {
    case "totals": return TOTALS_BASE + (input.showTax ? TOTALS_TAX_ROW : 0);
    case "payments": return PAYMENTS_HEAD + input.paymentCount * PAYMENTS_ROW;
    case "terms": return (block.first ? SECTION_CHROME : 0) + Math.max(1, block.lines.length) * INVOICE_LINE.terms;
    case "paymentInstructions": return PAYMENT_INSTRUCTIONS;
    case "notes": return NOTES_TOP + Math.max(1, block.lines.length) * INVOICE_LINE.notes;
  }
}

export function billToBlockHeight(block: InvoiceBillToBlock, input: { billTo: Array<string | null | undefined> }): number {
  if (block.mode === "full") return billToHeight(input.billTo);
  return BILL_TO_LABEL + block.lines.length * INVOICE_LINE.billTo + BILL_TO_MARGIN;
}

/** Estimated height of everything below the header on a laid-out paper. */
export function pageUsedHeight<T extends InvoiceLayoutItem>(page: InvoicePageLayout<T>, input: InvoiceLayoutInput<T>): number {
  return (page.billTo ? billToBlockHeight(page.billTo, input) : 0)
    + (page.training ? TRAINING_SECTION : 0)
    + (page.items.length ? TABLE_OVERHEAD : 0) + page.items.reduce((sum, item) => sum + invoiceItemHeight(item), 0)
    + page.final.reduce((sum, block) => sum + finalBlockHeight(block, input), 0);
}

/**
 * Pack Bill To, items, then the closing blocks, into papers. A block that does not fit the space left on a
 * paper moves to the next one; Bill To, terms and notes are split line by line, so every block always fits an
 * empty paper.
 */
export function layoutInvoicePages<T extends InvoiceLayoutItem>(input: InvoiceLayoutInput<T>): InvoicePageLayout<T>[] {
  const pages: InvoicePageLayout<T>[] = [{ items: [], final: [] }];
  const capacity = () => pageCapacity(pages.length - 1);
  let used = 0;
  const newPage = () => { pages.push({ items: [], final: [] }); used = 0; };
  const current = () => pages[pages.length - 1];
  const isEmpty = (page: InvoicePageLayout<T>) => !page.billTo && !page.training && page.items.length + page.final.length === 0;
  const fitOrBreak = (height: number) => { if (!isEmpty(current()) && used + height > capacity()) newPage(); };

  // Bill To on page 1, or flowed by line when it cannot fit there whole; the training summary follows it.
  const fullBillTo = billToHeight(input.billTo);
  const training = input.hasTraining ? TRAINING_SECTION : 0;
  if (fullBillTo <= capacity()) {
    pages[0].billTo = { mode: "full" };
    used += fullBillTo;
  } else {
    let remaining = billToFields(input.billTo).flatMap((field) => wrapLines(field, INVOICE_CPL.billTo));
    let first = true;
    while (remaining.length > 0) {
      if (!isEmpty(current())) newPage();
      const take = Math.max(1, Math.floor((capacity() - BILL_TO_LABEL - BILL_TO_MARGIN) / INVOICE_LINE.billTo));
      const block: InvoiceBillToBlock = { mode: "lines", lines: remaining.slice(0, take), first };
      remaining = remaining.slice(take);
      current().billTo = block;
      used = billToBlockHeight(block, input);
      first = false;
    }
  }
  if (input.hasTraining) { fitOrBreak(training); current().training = true; used += training; }

  for (const item of input.items) {
    const h = invoiceItemHeight(item);
    if (!isEmpty(current()) && used + (current().items.length === 0 ? TABLE_OVERHEAD : 0) + h > capacity()) newPage();
    used += (current().items.length === 0 ? TABLE_OVERHEAD : 0) + h;
    current().items.push(item);
  }

  const place = (block: InvoiceFinalBlock) => {
    const height = finalBlockHeight(block, input);
    fitOrBreak(height);
    current().final.push(block);
    used += height;
  };
  place({ kind: "totals" });
  if (input.paymentCount > 0) place({ kind: "payments" });

  // Terms and notes flow line by line; the section title stays with its first lines.
  const flow = (kind: "terms" | "notes", lines: string[]) => {
    let remaining = lines.slice();
    let first = true;
    while (remaining.length > 0) {
      const chrome = kind === "terms" ? (first ? SECTION_CHROME : 0) : NOTES_TOP;
      const lineHeight = kind === "terms" ? INVOICE_LINE.terms : INVOICE_LINE.notes;
      let room = capacity() - used - chrome;
      if (room < lineHeight * Math.min(2, remaining.length) && !isEmpty(current())) { newPage(); room = capacity() - chrome; }
      const take = Math.max(1, Math.floor(room / lineHeight));
      const chunk = remaining.slice(0, take);
      remaining = remaining.slice(take);
      const block: InvoiceFinalBlock = kind === "terms" ? { kind, lines: chunk, first } : { kind, lines: chunk };
      current().final.push(block);
      used += finalBlockHeight(block, input);
      first = false;
    }
  };
  flow("terms", wrapLines(input.termsText, INVOICE_CPL.terms));
  place({ kind: "paymentInstructions" });
  const noteLines = input.notes?.trim() ? wrapLines(input.notes.trim(), INVOICE_CPL.notes) : [];
  if (noteLines.length > 0) flow("notes", noteLines);
  return pages;
}
