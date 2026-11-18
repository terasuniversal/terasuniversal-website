// Public-First F-6: the Privacy Notice's own, fail-closed publication switch -- independent of TERAS_LEGAL_DRAFTS, which
// also opens the unapproved Terms draft and must stay off.
//
// PRIVACY_EFFECTIVE_DATE stays null until the owner approves publication. On the day the notice is published to
// Production, set it in the release commit to that date ("YYYY-MM-DD"). Only a valid ISO calendar date publishes
// /privacy and /privacy/ms; null or anything else keeps both routes a real HTTP 404, out of the sitemap and unlinked.
// The date shown on the page is this value, so the effective date is always the actual publication date.
export const PRIVACY_EFFECTIVE_DATE = null;

/** True only for a real ISO calendar date ("2026-02-30", "18/11/2026", "", null and other values are rejected). */
export function isPrivacyEffectiveDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export const privacyPublished = isPrivacyEffectiveDate(PRIVACY_EFFECTIVE_DATE);

const MONTHS = {
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  ms: ["Januari", "Februari", "Mac", "April", "Mei", "Jun", "Julai", "Ogos", "September", "Oktober", "November", "Disember"],
};

/** "18 November 2026" / "18 November 2026" -- the same calendar date in both languages; null while unpublished. */
export function privacyEffectiveDateText(lang) {
  if (!privacyPublished) return null;
  const [year, month, day] = PRIVACY_EFFECTIVE_DATE.split("-").map(Number);
  return `${day} ${MONTHS[lang === "ms" ? "ms" : "en"][month - 1]} ${year}`;
}
