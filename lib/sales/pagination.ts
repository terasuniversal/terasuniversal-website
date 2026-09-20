export const SALES_QUEUE_PAGE_SIZE = 50;

export function normalizePage(value: string | undefined): number {
  if (!value || !/^\d+$/.test(value)) return 1;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

export function pageCountFor(total: number, pageSize = SALES_QUEUE_PAGE_SIZE): number {
  return Math.ceil(Math.max(0, total) / pageSize);
}

export function clampPage(page: number, pageCount: number): number {
  return pageCount > 0 ? Math.min(page, pageCount) : 1;
}

export function pageRange(page: number, pageSize = SALES_QUEUE_PAGE_SIZE): { from: number; to: number } {
  const from = (page - 1) * pageSize;
  return { from, to: from + pageSize - 1 };
}
