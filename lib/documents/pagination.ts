export type MeasuredDocumentBlock = {
  id: string;
  height: number;
};

export type PaginationBudget = {
  firstPageHeight: number;
  continuationPageHeight: number;
  finalPageReserve: number;
};

/**
 * Deterministic block packer for print layouts. Heights are estimated from the
 * same text widths/line-heights used by the document CSS; it deliberately
 * operates on whole blocks and never uses browser scrollHeight arithmetic.
 */
export function paginateMeasuredBlocks<T>(
  blocks: Array<MeasuredDocumentBlock & { value: T }>,
  budget: PaginationBudget,
): T[][] {
  if (blocks.length === 0) return [[]];

  const pages: Array<Array<MeasuredDocumentBlock & { value: T }>> = [[]];
  const capacities = () => pages.length === 1 ? budget.firstPageHeight : budget.continuationPageHeight;

  for (const block of blocks) {
    const current = pages[pages.length - 1];
    const currentHeight = current.reduce((sum, item) => sum + item.height, 0);
    const capacity = capacities();
    if (current.length > 0 && currentHeight + block.height > capacity) pages.push([]);
    pages[pages.length - 1].push(block);
  }

  if (pages.length > 1) {
    const final = pages[pages.length - 1];
    const finalHeight = final.reduce((sum, item) => sum + item.height, 0);
    const finalCapacity = budget.continuationPageHeight - budget.finalPageReserve;
    while (final.length > 1 && finalHeight > finalCapacity) {
      const moved = final.shift();
      if (moved) pages[pages.length - 2].push(moved);
    }
  }

  return pages.map((page) => page.map((block) => block.value));
}

export function estimateTextLines(value: unknown, charactersPerLine: number): number {
  const text = String(value ?? "");
  if (!text) return 1;
  return text.split(/\r?\n/).reduce((total, line) => total + Math.max(1, Math.ceil(line.length / charactersPerLine)), 0);
}

export function estimateBlockHeight(value: unknown, charactersPerLine: number, lineHeight: number, verticalPadding: number): number {
  return estimateTextLines(value, charactersPerLine) * lineHeight + verticalPadding;
}
