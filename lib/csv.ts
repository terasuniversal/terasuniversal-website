// Characters a spreadsheet may skip before deciding whether a cell is a formula.
const LEADING_NOISE = /^[\s\u0000-\u001f\u007f ​-‍⁠﻿]+/;

// An international phone number: a plus sign, then digits, spaces, hyphens and brackets.
const PHONE_SHAPE = /^\+[0-9][0-9 ()-]{6,}$/;

/**
 * True when a spreadsheet could treat the cell as a formula. A tab or carriage
 * return first, or an `=`, `@`, `+` or `-` as the first real character, can
 * start one. The one exception is a phone-shaped value in a column that holds
 * phone numbers, so "+60 19-519 3834" survives; it must start with the plus
 * sign itself, so leading whitespace never earns the exception.
 */
export function isFormulaRisk(value: string, options: { phone?: boolean } = {}): boolean {
  if (value === "") return false;
  if (value[0] === "\t" || value[0] === "\r") return true;
  const first = value.replace(LEADING_NOISE, "")[0];
  if (first === "=" || first === "@") return true;
  if (first === "+" || first === "-") return !(options.phone && PHONE_SHAPE.test(value));
  return false;
}

/**
 * One CSV cell. Text that a spreadsheet could run as a formula gets a leading
 * single quote, so lead fields typed by the public cannot execute when staff
 * open the export. Quoting follows RFC 4180 for commas, quotes and line breaks.
 */
export function csvCell(value: unknown, options: { phone?: boolean } = {}): string {
  const text = value == null ? "" : String(value);
  const safe = isFormulaRisk(text, options) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
