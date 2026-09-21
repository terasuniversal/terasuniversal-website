const MALAYSIA_OFFSET_MINUTES = 8 * 60;
const LOCAL_DATE_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

function parseMalaysiaDateTimeLocal(value: string) {
  const match = LOCAL_DATE_TIME_RE.exec(value);
  if (!match) throw new Error("Invalid Malaysia datetime-local value");

  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);

  if (month < 1 || month > 12 || hour > 23 || minute > 59) {
    throw new Error("Invalid Malaysia datetime-local value");
  }

  const calendarProbe = new Date(Date.UTC(year, month - 1, day));
  if (
    calendarProbe.getUTCFullYear() !== year ||
    calendarProbe.getUTCMonth() !== month - 1 ||
    calendarProbe.getUTCDate() !== day
  ) {
    throw new Error("Invalid Malaysia datetime-local value");
  }

  return { year, month, day, hour, minute };
}

/**
 * Interprets a timezone-less datetime-local value as a Malaysia wall-clock
 * time (UTC+08:00), independent of the operator device timezone.
 */
export function malaysiaDateTimeLocalToUtcIso(value: string): string {
  const { year, month, day, hour, minute } = parseMalaysiaDateTimeLocal(value);
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - MALAYSIA_OFFSET_MINUTES * 60_000).toISOString();
}

/** Converts a stored UTC instant back to the Malaysia datetime-local value. */
export function utcIsoToMalaysiaDateTimeLocal(value: string): string {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) throw new Error("Invalid UTC timestamp");

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}
