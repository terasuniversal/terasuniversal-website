export type FollowUpDateTimeResult =
  | { valid: true; value: string | null }
  | { valid: false };

/** Validate datetime-local input while preserving the existing server-local-to-UTC conversion. */
export function parseFollowUpDateTimeLocal(value: string): FollowUpDateTimeResult {
  if (value === "") return { valid: true, value: null };
  const match = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) return { valid: false };

  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const date = new Date(value);
  if (year < 1000 || Number.isNaN(date.getTime())) return { valid: false };
  if (
    date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day ||
    date.getHours() !== hour || date.getMinutes() !== minute
  ) return { valid: false };
  return { valid: true, value: date.toISOString() };
}
