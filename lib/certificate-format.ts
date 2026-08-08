/**
 * Pure display-formatting helpers shared between the React certificate
 * renderer (CertificateDocument.tsx) and the HTML-string renderer
 * (certificate-html.ts) — kept in one place so the two stay visually
 * identical instead of drifting the way this codebase's sanitize helpers did.
 */

/** Long participant names must shrink rather than overflow the name block. */
export function fitHolderNameSize(name: string): number {
  const len = (name || "").length;
  if (len > 34) return 20;
  if (len > 26) return 24;
  if (len > 18) return 28;
  return 32;
}

/** "Conducted from" line — collapses to a single date when start === end or one is missing. */
export function formatDateRange(start?: string | null, end?: string | null): string | null {
  if (!start && !end) return null;
  if (start && end && start !== end) return `${start} – ${end}`;
  return start || end || null;
}

/**
 * The Participant Skills Record table renders whatever status text a template
 * author typed in — a checkmark must only be drawn when that text is actually
 * an affirmative outcome. Without this, a neutral status ("Pending", "N/A")
 * would still get a green "✓" purely from its position in the table, which
 * reads as an unearned achievement claim rather than the template's own words.
 */
export function isAffirmativeStatus(status: string): boolean {
  return /^(completed|achieved|pass(ed)?|present|competent)$/i.test((status || "").trim());
}
