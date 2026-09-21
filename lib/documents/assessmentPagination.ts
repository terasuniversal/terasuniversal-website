export type AssessmentPaginationOptions = {
  firstPageHeightMm: number;
  continuationPageHeightMm: number;
  finalPageReserveMm: number;
  firstPageSafetyMm: number;
};

export type MeasuredAssessmentRow<T> = {
  value: T;
  heightMm: number;
};

const ASSESSMENT_ROW_LINE_HEIGHT_MM = 4.1;
const ASSESSMENT_ROW_VERTICAL_PADDING_MM = 3.2;
const ASSESSMENT_ROW_SAFETY_MM = 0.8;

function estimateWrappedLines(value: unknown, charactersPerLine: number): number {
  const text = String(value ?? "");
  if (!text) return 1;
  return text.split(/\r?\n/).reduce((total, line) => {
    return total + Math.max(1, Math.ceil(line.length / charactersPerLine));
  }, 0);
}

/**
 * Estimate the rendered height of an Assessment Result row using the report's
 * fixed landscape column widths. The estimate intentionally treats long words
 * as breakable because the print CSS uses overflow-wrap:anywhere.
 */
export function estimateAssessmentRowHeightMm(row: {
  name: string;
  remarks: string;
  group?: string;
  competency?: string;
}, showGroupColumn = false): number {
  const nameLines = estimateWrappedLines(row.name, 30);
  const remarksLines = estimateWrappedLines(row.remarks, showGroupColumn ? 16 : 10);
  const groupLines = showGroupColumn ? estimateWrappedLines(row.group, 16) : 1;
  const competencyLines = estimateWrappedLines(row.competency, 15);
  const lineCount = Math.max(nameLines, remarksLines, groupLines, competencyLines);
  return Math.max(
    8,
    ASSESSMENT_ROW_VERTICAL_PADDING_MM + lineCount * ASSESSMENT_ROW_LINE_HEIGHT_MM + ASSESSMENT_ROW_SAFETY_MM,
  );
}

function sumHeight<T>(rows: Array<MeasuredAssessmentRow<T>>): number {
  return rows.reduce((sum, row) => sum + row.heightMm, 0);
}

/**
 * Pack measured rows into explicit print pages. The final page reserve is
 * applied while deciding the final page, so sign-off space is never borrowed
 * by table rows. A single oversized row is kept intact on its own page rather
 * than causing an empty-page loop; browser flow remains the only fallback for
 * a row taller than a physical page.
 */
export function paginateAssessmentRows<T>(
  rows: Array<MeasuredAssessmentRow<T>>,
  options: AssessmentPaginationOptions,
): T[][] {
  if (rows.length === 0) return [[]];

  const firstRegular = Math.max(1, options.firstPageHeightMm - options.firstPageSafetyMm);
  const continuationRegular = Math.max(1, options.continuationPageHeightMm);
  const finalCapacity = Math.max(1, options.continuationPageHeightMm - options.finalPageReserveMm);
  const firstFinalCapacity = Math.max(1, options.firstPageHeightMm - options.finalPageReserveMm);
  const totalHeight = sumHeight(rows);

  if (totalHeight <= firstFinalCapacity) return [rows.map((row) => row.value)];

  const pages: Array<Array<MeasuredAssessmentRow<T>>> = [];
  let cursor = 0;
  let isFirst = true;

  while (cursor < rows.length) {
    const remaining = rows.slice(cursor);
    const regularCapacity = isFirst ? firstRegular : Math.min(continuationRegular, finalCapacity);
    const finalPageCanFit = remaining.length > 0 && sumHeight(remaining) <= (isFirst ? firstFinalCapacity : finalCapacity);

    if (finalPageCanFit) {
      pages.push(remaining);
      break;
    }

    const current: Array<MeasuredAssessmentRow<T>> = [];
    let height = 0;
    while (cursor + current.length < rows.length) {
      const next = rows[cursor + current.length];
      if (current.length > 0 && height + next.heightMm > regularCapacity) break;
      current.push(next);
      height += next.heightMm;
      if (current.length === 1 && next.heightMm > regularCapacity) break;
    }
    pages.push(current);
    cursor += current.length;
    isFirst = false;
  }

  return pages.map((page) => page.map((row) => row.value));
}
