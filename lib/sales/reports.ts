/**
 * Sales CRM Phase 4C — shared server-side date-range resolution for
 * /admin/sales/reports. Asia/Kuala_Lumpur is a fixed UTC+8 offset
 * year-round (no DST since 1982), so every boundary here is plain
 * arithmetic — deterministic regardless of the server process's own
 * configured timezone. Same technique as lib/sales/crm.ts's
 * mytEndOfTodayUtc(); kept in this file rather than duplicated because
 * reports need arbitrary-date boundaries (month/quarter/year/custom), not
 * just "end of today".
 */

const MYT_OFFSET_MS = 8 * 60 * 60 * 1000;

/** Midnight of the given Y/M/D *in Asia/Kuala_Lumpur*, as a real UTC instant. monthIndex0 is 0-based (0 = January). */
function mytMidnightUtc(year: number, monthIndex0: number, day: number): Date {
  return new Date(Date.UTC(year, monthIndex0, day) - MYT_OFFSET_MS);
}

/** Today's calendar date *in Asia/Kuala_Lumpur*, derived from a real UTC instant. */
function mytTodayParts(referenceUtc: Date): { year: number; month: number; day: number } {
  const shifted = new Date(referenceUtc.getTime() + MYT_OFFSET_MS);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth(), day: shifted.getUTCDate() };
}

function parseYmd(s: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]) - 1, day: Number(m[3]) };
}

export type ReportRangeKey = "this_month" | "last_month" | "this_quarter" | "this_year" | "custom";
export const REPORT_RANGE_KEYS: ReportRangeKey[] = ["this_month", "last_month", "this_quarter", "this_year", "custom"];
export const REPORT_RANGE_LABELS: Record<ReportRangeKey, string> = {
  this_month: "This Month",
  last_month: "Last Month",
  this_quarter: "This Quarter",
  this_year: "This Year",
  custom: "Custom Range",
};

export interface ReportDateRange {
  key: ReportRangeKey;
  /** Inclusive start, UTC ISO instant. */
  startUtc: string;
  /** Exclusive end, UTC ISO instant. */
  endUtc: string;
  /** MYT calendar dates, for display only (YYYY-MM-DD). */
  startDateLabel: string;
  endDateLabel: string;
}

/**
 * Resolves a report range key (+ optional custom from/to, as plain
 * YYYY-MM-DD date-input strings interpreted as MYT calendar dates — never
 * as UTC or browser-local) into a [startUtc, endUtc) instant pair safe to
 * pass straight into .gte()/.lt() Supabase filters. Falls back to "This
 * Month" if a custom range is selected without valid from/to.
 */
export function resolveReportDateRange(
  key: ReportRangeKey,
  custom?: { from?: string; to?: string },
  referenceUtc: Date = new Date()
): ReportDateRange {
  const { year, month } = mytTodayParts(referenceUtc);

  const build = (resolvedKey: ReportRangeKey, start: Date, end: Date): ReportDateRange => ({
    key: resolvedKey,
    startUtc: start.toISOString(),
    endUtc: end.toISOString(),
    startDateLabel: start.toISOString().slice(0, 10),
    endDateLabel: new Date(end.getTime() - 1).toISOString().slice(0, 10),
  });

  if (key === "last_month") {
    const lmYear = month === 0 ? year - 1 : year;
    const lmMonth = month === 0 ? 11 : month - 1;
    return build("last_month", mytMidnightUtc(lmYear, lmMonth, 1), mytMidnightUtc(year, month, 1));
  }
  if (key === "this_quarter") {
    const qStartMonth = Math.floor(month / 3) * 3;
    const qEndMonth = qStartMonth + 3;
    const end = qEndMonth >= 12 ? mytMidnightUtc(year + 1, qEndMonth - 12, 1) : mytMidnightUtc(year, qEndMonth, 1);
    return build("this_quarter", mytMidnightUtc(year, qStartMonth, 1), end);
  }
  if (key === "this_year") {
    return build("this_year", mytMidnightUtc(year, 0, 1), mytMidnightUtc(year + 1, 0, 1));
  }
  if (key === "custom") {
    const from = custom?.from ? parseYmd(custom.from) : null;
    const to = custom?.to ? parseYmd(custom.to) : null;
    if (from && to) {
      // End is exclusive — midnight of the day *after* "to", so the whole "to" day is included.
      const end = mytMidnightUtc(to.year, to.month, to.day + 1);
      const start = mytMidnightUtc(from.year, from.month, from.day);
      if (start < end) return build("custom", start, end);
    }
    // Invalid/incomplete custom range — safe fallback, not a silent empty range.
    return build("this_month", mytMidnightUtc(year, month, 1), mytMidnightUtc(month === 11 ? year + 1 : year, month === 11 ? 0 : month + 1, 1));
  }
  // this_month (default)
  return build("this_month", mytMidnightUtc(year, month, 1), mytMidnightUtc(month === 11 ? year + 1 : year, month === 11 ? 0 : month + 1, 1));
}

/** Key for grouping a UTC timestamp into its Asia/Kuala_Lumpur calendar month, e.g. "2026-08". Used for Monthly Trend bucketing. */
export function mytMonthKey(isoUtc: string): string {
  const shifted = new Date(new Date(isoUtc).getTime() + MYT_OFFSET_MS);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Human label for a mytMonthKey() value, e.g. "2026-08" -> "Aug 2026". */
export function monthKeyLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-MY", { month: "short", year: "numeric", timeZone: "UTC" });
}

/** Ordered list of month keys from startUtc (inclusive) to endUtc (exclusive), in MYT. */
export function monthKeysInRange(startUtc: string, endUtc: string): string[] {
  const keys: string[] = [];
  let cursor = mytMonthKey(startUtc);
  const endKey = mytMonthKey(new Date(new Date(endUtc).getTime() - 1).toISOString());
  while (cursor <= endKey) {
    keys.push(cursor);
    const [y, m] = cursor.split("-").map(Number);
    const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
    cursor = next;
    if (keys.length > 240) break; // 20-year safety cap, never realistically hit
  }
  return keys;
}

/** Percentage as "NN.N%", or "N/A" when the denominator is zero — never a misleading 0%. */
export function conversionRate(numerator: number, denominator: number): string {
  if (denominator <= 0) return "N/A";
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}
