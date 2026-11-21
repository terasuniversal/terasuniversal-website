// Detects free text that looks like (or hides) an IC / Passport number. Dependency-free on purpose so a plain Node
// script can load it and check it against the very same test vectors the SQL function is tested with
// (scripts/identity-correction/identity-text-vectors.json). The SQL twin is identity_audit.text_has_identity() in
// migration 02 -- the folding and the five patterns below and in SQL must stay identical; the vectors enforce that.
//
// Rejected values are never logged or echoed: callers only ever show a fixed message.

// Folding: Unicode NFKC (full-width forms, circled/superscript digits, ...), invisible/format characters removed, and the
// digits of Arabic-Indic, Extended Arabic-Indic, Devanagari, Bengali, Tamil and Thai scripts mapped to 0-9.
// Digits of other scripts are NOT recognised (documented limit).
const FORMAT_CHARS = /[\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g;
const DIGIT_ZEROS = [0x0660, 0x06f0, 0x0966, 0x09e6, 0x0be6, 0x0e50];
const FOREIGN_DIGITS = /[\u0660-\u0669\u06F0-\u06F9\u0966-\u096F\u09E6-\u09EF\u0BE6-\u0BEF\u0E50-\u0E59]/g;

export function foldText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(FORMAT_CHARS, "")
    .replace(FOREIGN_DIGITS, (ch) => {
      const cp = ch.codePointAt(0) as number;
      const zero = DIGIT_ZEROS.find((z) => cp >= z && cp < z + 10) as number;
      return String(cp - zero);
    });
}

const PATTERNS: RegExp[] = [
  // IC: 6-2-4 digits, up to 3 separator characters of any kind between groups (or none = 12 contiguous digits)
  /(^|[^0-9])\d{6}[^A-Za-z0-9]{0,3}\d{2}[^A-Za-z0-9]{0,3}\d{4}([^0-9]|$)/,
  // 12 digits each separated by one or two characters ("9 0 0 1 ...")
  /(^|[^0-9])(\d[^A-Za-z0-9]{1,2}){11}\d([^0-9]|$)/,
  // four groups of three digits
  /(^|[^0-9])\d{3}[^A-Za-z0-9]{1,2}\d{3}[^A-Za-z0-9]{1,2}\d{3}[^A-Za-z0-9]{1,2}\d{3}([^0-9]|$)/,
  // passport: 1 letter + 8 digits, or 2 letters + 7 digits, optional hyphen
  /(^|[^A-Za-z0-9])[A-Za-z]-?\d{8}([^0-9]|$)/,
  /(^|[^A-Za-z0-9])[A-Za-z]{2}-?\d{7}([^0-9]|$)/,
];

export function looksLikeIdentity(text: string): boolean {
  const folded = foldText(text);
  return PATTERNS.some((re) => re.test(folded));
}
