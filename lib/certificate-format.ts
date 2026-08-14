import QRCode from "qrcode";

/**
 * Pure display-formatting helpers shared between the React certificate
 * renderer (CertificateDocument.tsx) and the HTML-string renderer
 * (certificate-html.ts) — kept in one place so the two stay visually
 * identical instead of drifting the way this codebase's sanitize helpers did.
 */

/**
 * Generates the verification QR as an inline SVG string, computed once in
 * certData.ts and reused by both renderers. Previously this loaded an <img>
 * from api.qrserver.com — that request is blocked by this app's own CSP
 * (`img-src 'self' data: blob:` in next.config.mjs has no allowance for a
 * third-party image host), so the QR silently failed to render in every real
 * browser context (broken-image icon) despite working in ad hoc test pages
 * that don't send that header. Generating in-process and embedding as inline
 * SVG sidesteps img-src entirely — it's DOM content, not an image request —
 * and gives a sharper, infinitely-scalable result for print.
 */
export async function generateQrSvg(value: string, colorDark = "#0B3A63"): Promise<string | null> {
  try {
    const svg = await QRCode.toString(value, { type: "svg", margin: 1, color: { dark: colorDark, light: "#FFFFFF" } });
    // No fixed width/height, only a viewBox, so the same string can be
    // embedded at any display size (front page ~100px, back page smaller)
    // just by sizing its wrapping container.
    return svg.replace("<svg ", '<svg width="100%" height="100%" ');
  } catch (err) {
    console.error("generateQrSvg failed", err);
    return null;
  }
}

/** Long participant names must shrink rather than overflow the name block. */
export function fitHolderNameSize(name: string): number {
  const len = (name || "").length;
  if (len > 34) return 20;
  if (len > 26) return 24;
  if (len > 18) return 28;
  return 32;
}

/**
 * Renders a "YYYY-MM-DD" date column value as "12 July 2026". Parses and
 * formats in UTC throughout — the source is a date-only Postgres column with
 * no time component, so treating it as local time would risk shifting the
 * displayed day by one depending on the server's timezone. Strict: rejects
 * anything that isn't a real calendar date rather than letting JS Date
 * silently roll an overflow like 2026-02-31 into 2026-03-03 — Postgres
 * `date` columns can't hold that, but this also runs on plain strings, so it
 * must not trust the input. Invalid input returns the raw string unchanged
 * so a bad value is visibly wrong rather than silently different.
 */
export function formatHumanDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  const [, y, m, d] = match;
  const year = Number(y), month = Number(m), day = Number(d);
  const date = new Date(Date.UTC(year, month - 1, day));
  const roundTripped = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  if (!roundTripped) return value;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(date);
}

/** "Conducted from" line — collapses to a single date when start === end or one is missing. */
export function formatDateRange(start?: string | null, end?: string | null): string | null {
  if (!start && !end) return null;
  if (start && end && start !== end) return `${formatHumanDate(start)} – ${formatHumanDate(end)}`;
  return formatHumanDate((start || end) as string);
}

/**
 * The Participant Skills Record table renders whatever status text a template
 * author typed in — a checkmark must only be drawn when that text is actually
 * an affirmative outcome. Without this, a neutral status ("Pending", "N/A")
 * would still get a green "✓" purely from its position in the table, which
 * reads as an unearned achievement claim rather than the template's own words.
 *
 * "met" is anchored (^...$), matching the whole trimmed string only — not a
 * substring test — so "Not Met" can never match this branch; it's a distinct
 * full string, not "met" with extra characters. Same reasoning already
 * applies to "pass(ed)?" not matching "Not Passed" etc.
 */
export function isAffirmativeStatus(status: string): boolean {
  // "met" is the Attendance Requirement row's affirmative value (the
  // attendance_requirement CHECK allows exactly not_recorded|met|not_met), and
  // it was missing here — that row rendered "– Met" in muted grey while every
  // other satisfied area got a gold "✓". The alternation is anchored, so
  // "Not Met" still correctly reads as non-affirmative.
  return /^(completed|achieved|pass(ed)?|present|competent|met)$/i.test((status || "").trim());
}
