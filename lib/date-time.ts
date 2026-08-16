/**
 * Admin CMS display-formatting for timestamps. The database stores UTC
 * instants; the admin UI always renders them in Asia/Kuala_Lumpur (fixed
 * UTC+8, no DST). Intl.DateTimeFormat with an explicit timeZone is
 * deterministic across server and browser regardless of each process's own
 * default timezone, so the same string is produced on both sides of
 * hydration and no double +8 shift can occur.
 *
 * These helpers are for timestamps only — date-only business fields (course
 * start/end dates, session dates, certificate issue/completion dates, etc.)
 * are calendar dates and must keep being rendered as-is, never shifted.
 */

export const MYT_TIME_ZONE = "Asia/Kuala_Lumpur";

const MALAYSIA_DATE_TIME_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: MYT_TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  hour12: true,
});

const MALAYSIA_DATE_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: MYT_TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const MALAYSIA_TIME_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: MYT_TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  hour12: true,
});

const MALAYSIA_LONG_DATE_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: MYT_TIME_ZONE,
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

function toInstant(value: Date | string | number | null | undefined): Date | null {
  if (value == null || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "DD/MM/YYYY, h:mm:ss am/pm" in Asia/Kuala_Lumpur. Null/invalid -> "—". */
export function formatMalaysiaDateTime(value: Date | string | number | null | undefined): string {
  const instant = toInstant(value);
  return instant ? MALAYSIA_DATE_TIME_FMT.format(instant) : "—";
}

/** "DD/MM/YYYY" in Asia/Kuala_Lumpur for a timestamp rendered as a date. Null/invalid -> "—". */
export function formatMalaysiaDate(value: Date | string | number | null | undefined): string {
  const instant = toInstant(value);
  return instant ? MALAYSIA_DATE_FMT.format(instant) : "—";
}

/** "h:mm:ss am/pm" in Asia/Kuala_Lumpur. Null/invalid -> "—". */
export function formatMalaysiaTime(value: Date | string | number | null | undefined): string {
  const instant = toInstant(value);
  return instant ? MALAYSIA_TIME_FMT.format(instant) : "—";
}

/** "Sunday, 16 August 2026" in Asia/Kuala_Lumpur. Null/invalid -> "—". */
export function formatMalaysiaLongDate(value: Date | string | number | null | undefined): string {
  const instant = toInstant(value);
  return instant ? MALAYSIA_LONG_DATE_FMT.format(instant) : "—";
}
