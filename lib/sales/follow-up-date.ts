import { parseMalaysiaDateTimeLocal } from "./malaysia-datetime-local.js";

export type FollowUpDateTimeResult =
  | { valid: true; value: string | null }
  | { valid: false };

/** Validate datetime-local input and interpret it as Malaysia wall-clock time. */
export function parseFollowUpDateTimeLocal(value: string): FollowUpDateTimeResult {
  if (value === "") return { valid: true, value: null };
  const parsed = parseMalaysiaDateTimeLocal(value);
  return parsed ? { valid: true, value: parsed } : { valid: false };
}
