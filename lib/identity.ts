/**
 * Canonical normalization for participant IC/passport identity numbers.
 * Strips whitespace and punctuation (hyphens, spaces) and uppercases —
 * never removes letters or digits, so passport numbers like "A1234567"
 * are preserved intact, only formatting differences are ignored.
 *
 * This exactly matches the live `participants_active_ic_passport_unique`
 * index's expression (`upper(regexp_replace(ic_passport_no, '[^0-9A-Za-z]',
 * '', 'g'))`) so the application-side pre-check and the database's own
 * safety net agree on what counts as a duplicate. Used by participant
 * create, update, and CSV import — do not add a second implementation.
 *
 * Note: the older `participants_active_identity_unique` index (on the
 * separate `identity_no` column, populated only by the legacy
 * /api/admin/certificates import path) strips punctuation the same way but
 * has no `upper()` — it is case-*sensitive*. That index predates this file
 * and is intentionally left as-is here; do not assume the two columns have
 * equivalent protection.
 */
export function normalizeIdentityNumber(value: string | null | undefined): string {
  return (value ?? "").replace(/[^0-9A-Za-z]/g, "").toUpperCase();
}
