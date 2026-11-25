
/**
 * DOC-4: A4 quotation pagination that matches the printed sheets.
 *
 * The previous packer estimated items at 62 characters per 14px line and treated totals + terms + notes as one
 * reserve that could never be split, so long and extreme quotations overflowed their fixed 297mm papers: the tail
 * printed under the running footer or on top of the next sheet's header. Training details (up to 100 participant
 * names, 1000-character addresses) were not budgeted at all.
 *
 * Unlike the invoice, the quotation's on-screen preview uses larger type than its print CSS (12px vs 10px), so
 * this model is calibrated against the PRINT geometry (measured in Chromium print media on a 210mm paper).
 * DocumentPrintController verifies the same geometry at runtime by briefly applying the print rules
 * (`html[data-print-geometry]`) before it allows printing.
 *
 * Every estimate is conservative (narrow characters-per-line, line-heights rounded up), so an error can only
 * move content to a later page. Sections, terms and notes that cannot fit an empty page flow line by line.
 */

/** Print geometry, CSS px at 96/in: 297mm paper, 10mm top padding, running footer (2 lines) from 1045px. */
export const QUOTATION_PAPER = { height: 1123, paddingTop: 38, footerTop: 1045 } as const;
const HEADER = 198; // DocumentHeader in print, repeated on every paper
export const QUOTATION_SAFETY_MARGIN = 24;
/** Content space below the header on every paper. */
export const QUOTATION_CAPACITY = QUOTATION_PAPER.footerTop - 4 - QUOTATION_PAPER.paddingTop - HEADER - QUOTATION_SAFETY_MARGIN;

/** Print line-heights: 10px text x 1.45 (cards, items), 10px x 1.5 (terms), 12px x 1.45 (course name). */
export const QUOTATION_LINE = { text: 14.5, terms: 15, course: 17.4 } as const;
/**
 * Characters per line at print width (paper content 704px), below the measured Chromium values (course 33,
 * description 45, package 39, half card 58, full width 100+) so word-wrap waste is covered. Wide glyphs are
 * weighted separately (visualLength), so ALL-CAPS text cannot slip through.
 */
export const QUOTATION_CPL = { cardHalf: 50, cardHalfStrong: 42, cardFull: 96, course: 30, description: 42, package: 36, wide: 100 } as const;

/** Text width in "average lowercase characters": capitals and digits are wider, W/M/@/%/— much wider. */
export function visualLength(text: string): number {
  let width = 0;
  for (const ch of text) width += /[WM@%—&]/.test(ch) ? 1.75 : /[A-Z0-9]/.test(ch) ? 1.3 : 1;
  return width;
}
/** Greedy word wrap by visual width, so a wrapped line never renders wider than its budget (one line = one row). */
export function wrapVisual(text: string, charactersPerLine: number): string[] {
  const out: string[] = [];
  for (const paragraph of String(text ?? "").split(/\r?\n/)) {
    let line = "";
    for (const word of paragraph.split(" ")) {
      let candidate = line ? `${line} ${word}` : word;
      if (visualLength(candidate) <= charactersPerLine) { line = candidate; continue; }
      if (line) { out.push(line); line = ""; }
      candidate = word;
      while (visualLength(candidate) > charactersPerLine) {
        let cut = 0;
        let width = 0;
        for (const ch of candidate) { const w = visualLength(ch); if (width + w > charactersPerLine) break; width += w; cut += ch.length; }
        out.push(candidate.slice(0, Math.max(1, cut)));
        candidate = candidate.slice(Math.max(1, cut));
      }
      line = candidate;
    }
    out.push(line);
  }
  return out;
}

/** Display lines for text at a characters-per-line budget, per paragraph, weighted by glyph width. */
export function visualLines(text: string, charactersPerLine: number): number {
  const value = String(text ?? "");
  if (!value) return 1;
  return value.split(/\r?\n/).reduce((total, line) => total + Math.max(1, Math.ceil(visualLength(line) / charactersPerLine)), 0);
}

const SECTION_CHROME = 11 + 6 + 1 + 22 + 6; // margin, padding, border, title (incl. gold rule), title margin
const CARD_CHROME = 14 + 2 + 21; // padding, border, label + its margin (rounded up)
const CARD_MIN = 52;
const CARD_GAP = 8;
const ITEM_CHROME = 12 + 1 + 1; // cell padding, row border, sub-pixel rounding
const TABLE_HEAD = 26;
const TOTALS = 8 + 104; // margin + subtotal, discount, tax, grand total
const TRAINING_NOTES = SECTION_CHROME + 15;
const INFO_LABEL_ROW = 19; // label line + spacing above it
const GAP_ROW = 10;

export interface QuotationCard { label: string; strong?: string | null; text?: string | null; full?: boolean }
export interface QuotationInfoSection { key: string; title: string; cards: QuotationCard[] }
export interface QuotationLayoutItem {
  id: string;
  course_name_snapshot?: string | null;
  description?: string | null;
  hrdf_claim?: boolean | null;
  packageLabels: string[];
}
export interface QuotationLayoutInput<T extends QuotationLayoutItem> {
  infoSections: QuotationInfoSection[];
  items: T[];
  /** Terms text (validity line + free text), or null when the Terms / Notes section is not shown. */
  termsText: string | null;
  notes: string | null | undefined;
  trainingNotes: boolean;
}

export type QuotationRow = { type: "label" | "strong" | "text"; text: string } | { type: "gap" };
export type QuotationBlock<T> =
  | { kind: "info"; key: string }
  | { kind: "infoLines"; title: string; rows: QuotationRow[]; first: boolean }
  | { kind: "items"; items: T[]; first: boolean }
  | { kind: "totals" }
  | { kind: "termsNotes"; rows: QuotationRow[]; first: boolean }
  | { kind: "trainingNotes" };
export interface QuotationPageLayout<T> { blocks: QuotationBlock<T>[] }

function paragraphs(text: string | null | undefined): string[] {
  return String(text ?? "").replace(/^\n+/, "").split(/\r?\n/);
}

export function cardHeight(card: QuotationCard): number {
  const strongLines = card.strong?.trim() ? visualLines(card.strong, card.full ? QUOTATION_CPL.cardFull : QUOTATION_CPL.cardHalfStrong) : 0;
  const text = card.text?.replace(/^\n+/, "") ?? "";
  const textLines = text ? visualLines(text, card.full ? QUOTATION_CPL.cardFull : QUOTATION_CPL.cardHalf) : 0;
  return Math.max(CARD_MIN, CARD_CHROME + Math.max(1, strongLines + textLines) * QUOTATION_LINE.text);
}

/** Height of a card grid section rendered whole (two cards per row; a full-width card takes its own row). */
export function infoSectionHeight(section: QuotationInfoSection): number {
  const rows: number[] = [];
  let pending: number[] = [];
  for (const card of section.cards) {
    if (card.full) { if (pending.length) rows.push(Math.max(...pending)); pending = []; rows.push(cardHeight(card)); continue; }
    pending.push(cardHeight(card));
    if (pending.length === 2) { rows.push(Math.max(...pending)); pending = []; }
  }
  if (pending.length) rows.push(Math.max(...pending));
  return SECTION_CHROME + rows.reduce((sum, h) => sum + h, 0) + CARD_GAP * Math.max(0, rows.length - 1);
}

export function infoSectionRows(section: QuotationInfoSection): QuotationRow[] {
  const rows: QuotationRow[] = [];
  section.cards.forEach((card, index) => {
    if (index > 0) rows.push({ type: "gap" });
    rows.push({ type: "label", text: card.label });
    if (card.strong?.trim()) for (const line of wrapVisual(card.strong.trim(), QUOTATION_CPL.wide)) rows.push({ type: "strong", text: line });
    for (const paragraph of paragraphs(card.text)) for (const line of wrapVisual(paragraph, QUOTATION_CPL.wide)) rows.push({ type: "text", text: line });
  });
  return rows;
}

export function rowHeight(row: QuotationRow, lineHeight: number = QUOTATION_LINE.text): number {
  if (row.type === "gap") return GAP_ROW;
  if (row.type === "label") return Math.max(INFO_LABEL_ROW, lineHeight);
  return lineHeight;
}

export function quotationItemHeight(item: QuotationLayoutItem): number {
  const course = item.course_name_snapshot?.trim() ? 5 + visualLines(`${item.course_name_snapshot}${item.hrdf_claim ? " HRDF" : ""}`, QUOTATION_CPL.course) * QUOTATION_LINE.course : 0;
  const description = visualLines(item.description ?? "", QUOTATION_CPL.description) * QUOTATION_LINE.text;
  const pkg = item.packageLabels.length > 0 ? 5 + visualLines(`Package Includes: ${item.packageLabels.join("  |  ")}`, QUOTATION_CPL.package) * QUOTATION_LINE.text : 0;
  return ITEM_CHROME + course + description + pkg;
}

export function termsNotesRows(termsText: string, notes: string | null | undefined): QuotationRow[] {
  const rows: QuotationRow[] = [{ type: "label", text: "Terms" }];
  for (const paragraph of paragraphs(termsText)) for (const line of wrapVisual(paragraph, QUOTATION_CPL.wide)) rows.push({ type: "text", text: line });
  if (notes?.trim()) {
    rows.push({ type: "gap" }, { type: "label", text: "Notes" });
    for (const paragraph of paragraphs(notes.trim())) for (const line of wrapVisual(paragraph, QUOTATION_CPL.wide)) rows.push({ type: "text", text: line });
  }
  return rows;
}

export function blockHeight<T extends QuotationLayoutItem>(block: QuotationBlock<T>, input: QuotationLayoutInput<T>): number {
  switch (block.kind) {
    case "info": return infoSectionHeight(input.infoSections.find((section) => section.key === block.key)!);
    case "infoLines": return SECTION_CHROME + block.rows.reduce((sum, row) => sum + rowHeight(row), 0);
    case "items": return SECTION_CHROME + TABLE_HEAD + block.items.reduce((sum, item) => sum + quotationItemHeight(item), 0);
    case "totals": return TOTALS;
    case "termsNotes": return SECTION_CHROME + block.rows.reduce((sum, row) => sum + rowHeight(row, QUOTATION_LINE.terms), 0);
    case "trainingNotes": return TRAINING_NOTES;
  }
}

export function quotationPageUsedHeight<T extends QuotationLayoutItem>(page: QuotationPageLayout<T>, input: QuotationLayoutInput<T>): number {
  return page.blocks.reduce((sum, block) => sum + blockHeight(block, input), 0);
}

/**
 * Pack the customer/programme sections, items, totals, terms/notes and training notes into A4 papers in their
 * original order. Whole blocks move to the next paper when they do not fit; anything taller than an empty paper
 * flows row by row with a "— Continued" title.
 */
export function layoutQuotationPages<T extends QuotationLayoutItem>(input: QuotationLayoutInput<T>): QuotationPageLayout<T>[] {
  const pages: QuotationPageLayout<T>[] = [{ blocks: [] }];
  const cap = QUOTATION_CAPACITY;
  let used = 0;
  const current = () => pages[pages.length - 1];
  const newPage = () => { pages.push({ blocks: [] }); used = 0; };
  const place = (block: QuotationBlock<T>) => {
    const h = blockHeight(block, input);
    if (current().blocks.length > 0 && used + h > cap) newPage();
    current().blocks.push(block);
    used += h;
  };
  // Flow rows; never end a chunk on a label or gap, and never start one with a gap.
  const flow = (rows: QuotationRow[], lineHeight: number, make: (chunk: QuotationRow[], first: boolean) => QuotationBlock<T>) => {
    let remaining = rows.slice();
    let first = true;
    while (remaining.length > 0) {
      while (remaining[0]?.type === "gap") remaining = remaining.slice(1);
      if (remaining.length === 0) break;
      let room = cap - used - SECTION_CHROME;
      const minimum = rowHeight(remaining[0], lineHeight) + (remaining[1] ? rowHeight(remaining[1], lineHeight) : 0);
      if (room < minimum && current().blocks.length > 0) { newPage(); room = cap - SECTION_CHROME; }
      let take = 0;
      let h = 0;
      while (take < remaining.length && h + rowHeight(remaining[take], lineHeight) <= room) { h += rowHeight(remaining[take], lineHeight); take++; }
      while (take > 1 && take < remaining.length && (remaining[take - 1].type === "label" || remaining[take - 1].type === "gap")) take--;
      take = Math.max(1, take);
      const block = make(remaining.slice(0, take), first);
      current().blocks.push(block);
      used += blockHeight(block, input);
      remaining = remaining.slice(take);
      first = false;
      if (remaining.length > 0) newPage();
    }
  };

  for (const section of input.infoSections) {
    if (infoSectionHeight(section) <= cap) place({ kind: "info", key: section.key });
    else flow(infoSectionRows(section), QUOTATION_LINE.text, (rows, first) => ({ kind: "infoLines", title: section.title, rows, first }));
  }

  let firstItems = true;
  if (input.items.length === 0) { place({ kind: "items", items: [], first: true }); firstItems = false; }
  for (const item of input.items) {
    const last = current().blocks[current().blocks.length - 1];
    const h = quotationItemHeight(item);
    if (last?.kind === "items" && used + h <= cap) { last.items.push(item); used += h; continue; }
    const chrome = SECTION_CHROME + TABLE_HEAD;
    if (current().blocks.length > 0 && used + chrome + h > cap) newPage();
    current().blocks.push({ kind: "items", items: [item], first: firstItems });
    used += chrome + h;
    firstItems = false;
  }

  place({ kind: "totals" });
  if (input.termsText !== null) flow(termsNotesRows(input.termsText, input.notes), QUOTATION_LINE.terms, (rows, first) => ({ kind: "termsNotes", rows, first }));
  if (input.trainingNotes) place({ kind: "trainingNotes" });
  return pages;
}
