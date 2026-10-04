/** @type {number} */
const MALAYSIA_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * Interpret an HTML datetime-local wall-clock value as Asia/Kuala_Lumpur.
 * @param {string} value
 * @returns {string | null}
 */
export function parseMalaysiaDateTimeLocal(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) return null;

  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (year < 1000) return null;

  const malaysiaWallClockAsUtcMs = Date.UTC(year, month - 1, day, hour, minute);
  const validatedWallClock = new Date(malaysiaWallClockAsUtcMs);
  if (
    validatedWallClock.getUTCFullYear() !== year || validatedWallClock.getUTCMonth() !== month - 1 ||
    validatedWallClock.getUTCDate() !== day || validatedWallClock.getUTCHours() !== hour ||
    validatedWallClock.getUTCMinutes() !== minute
  ) return null;

  return new Date(malaysiaWallClockAsUtcMs - MALAYSIA_UTC_OFFSET_MS).toISOString();
}
