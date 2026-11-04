// Per-browser display preferences for the admin shell (collapsed rail and
// collapsed nav groups). They live in cookies, not localStorage, so the server
// layout can render the saved state on the first paint instead of flashing the
// default and snapping after hydration. Never read for access decisions: they
// only choose how an already-filtered navigation is laid out.

export const RAIL_COOKIE = "ta-rail";
export const COLLAPSED_COOKIE = "ta-nav-collapsed";

const MAX_AGE = 60 * 60 * 24 * 365;
const MAX_GROUPS = 32;
const MAX_LABEL = 80;
// A real value is a few hundred bytes (about ten short group names); refuse to parse anything larger.
const MAX_COOKIE = 4096;

export function parseRail(value: string | undefined): boolean {
  return value === "1";
}

/** Tolerant of a missing, malformed or hand-edited cookie: anything odd means "nothing collapsed". */
export function parseCollapsed(value: string | undefined): string[] {
  if (!value || value.length > MAX_COOKIE) return [];
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(value));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string" && v.length <= MAX_LABEL).slice(0, MAX_GROUPS);
  } catch {
    return [];
  }
}

function cookie(name: string, value: string): string {
  // Scoped to /admin so the public site never receives it.
  return `${name}=${value}; path=/admin; max-age=${MAX_AGE}; samesite=lax`;
}

export function railCookie(rail: boolean): string {
  return cookie(RAIL_COOKIE, rail ? "1" : "0");
}

export function collapsedCookie(labels: readonly string[]): string {
  return cookie(COLLAPSED_COOKIE, encodeURIComponent(JSON.stringify(labels.slice(0, MAX_GROUPS))));
}
