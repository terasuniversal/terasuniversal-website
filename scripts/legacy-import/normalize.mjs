// Deterministic normalization helpers for Legacy Participant Migration
// staging import. Normalization is for MATCHING ONLY -- callers must keep
// the raw source value untouched alongside whatever these return.

export function normalizeIcPassport(raw) {
  if (!raw) return null;
  const cleaned = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return cleaned || null;
}

export function normalizePhone(raw) {
  if (!raw) return null;
  const digits = raw.trim().replace(/[^0-9]/g, "");
  return digits || null;
}

export function normalizeEmail(raw) {
  if (!raw) return null;
  const cleaned = raw.trim().toLowerCase();
  return cleaned || null;
}

export function normalizeName(raw) {
  if (!raw) return null;
  const cleaned = raw.trim().toUpperCase().replace(/\s+/g, " ");
  return cleaned || null;
}

// Matching key only -- deliberately does NOT strip site suffixes like
// "(UNIKL)". Two source rows that only differ by such a suffix are NOT
// treated as the same course; course mapping always requires an explicit,
// human-approved legacy_course_map row (see section 9 of the Phase 1 task).
export function normalizeCourseName(raw) {
  if (!raw) return null;
  const cleaned = raw.trim().toUpperCase().replace(/\s+/g, " ");
  return cleaned || null;
}
