// W5-a (owner-approved D-07): explicit opt-in consent for Google Analytics 4. Pure helpers with injected browser
// objects, so scripts/w5a-ga4-consent-contract.mts can unit-test them without a browser.
//
// - Nothing analytics-related loads until the visitor chooses "Accept analytics"; "Reject" is remembered too.
// - The choice is kept in localStorage (the visitor's own preference, not a tracking identifier). Storage can be
//   unavailable (private mode, blocked site data): every access is wrapped, and an unreadable choice counts as "no
//   choice yet", so analytics stays off.
// - Withdrawing consent switches GA4 off for the rest of the visit and deletes the GA4 cookies this site can reach.
export const CONSENT_STORAGE_KEY = "teras-analytics-consent";
export const CONSENT_CHANGE_EVENT = "teras-analytics-consent-change";
export const CONSENT_GRANTED = "granted";
export const CONSENT_DENIED = "denied";

/** A real GA4 measurement ID ("G-" and 4-16 upper-case letters or digits); anything else keeps analytics disabled. */
export function isValidMeasurementId(value) {
  return typeof value === "string" && /^G-[A-Z0-9]{4,16}$/.test(value);
}

/** "granted", "denied" or null (no choice yet, or storage unavailable). */
export function readConsent(storage) {
  try {
    const value = storage?.getItem(CONSENT_STORAGE_KEY);
    return value === CONSENT_GRANTED || value === CONSENT_DENIED ? value : null;
  } catch {
    return null;
  }
}

/** Stores the visitor's choice; returns false when storage is unavailable (the choice then lasts for this page only). */
export function writeConsent(storage, value) {
  if (value !== CONSENT_GRANTED && value !== CONSENT_DENIED) return false;
  try {
    storage?.setItem(CONSENT_STORAGE_KEY, value);
    return true;
  } catch {
    return false;
  }
}

/** Names of the GA4 cookies present in a document.cookie string (_ga and _ga_<container>). */
export function gaCookieNames(cookieString) {
  if (typeof cookieString !== "string") return [];
  return cookieString.split(";").map((part) => part.split("=")[0].trim()).filter((name) => name === "_ga" || /^_ga_[A-Za-z0-9]+$/.test(name));
}

/** True when GA4 may be offered at all: production build with a valid measurement ID (otherwise no banner, no script). */
export function analyticsConfigured(nodeEnv, id) {
  return nodeEnv === "production" && isValidMeasurementId(id);
}

/**
 * Records the visitor's choice (banner or /privacy settings) and tells the Analytics component. Rejecting or
 * withdrawing also deletes the GA4 cookies this site can reach; GA4 itself is switched off by the component through
 * window["ga-disable-<ID>"], so nothing more is sent for the rest of the visit.
 */
export function applyConsentChoice(win, value) {
  if (value !== CONSENT_GRANTED && value !== CONSENT_DENIED) return;
  let storage = null;
  try { storage = win.localStorage; } catch { storage = null; }
  writeConsent(storage, value);
  win.__TERAS_ANALYTICS_CHOICE__ = value;
  win.__TERAS_ANALYTICS_CONSENT__ = value === CONSENT_GRANTED;
  if (value === CONSENT_DENIED) for (const deletion of gaCookieDeletions(win.document.cookie, win.location.hostname)) win.document.cookie = deletion;
  win.dispatchEvent(new Event(CONSENT_CHANGE_EVENT));
}

/** document.cookie assignments that expire each GA4 cookie on this host and its parent domains. */
export function gaCookieDeletions(cookieString, hostname) {
  const parts = typeof hostname === "string" ? hostname.split(".") : [];
  const domains = [""];
  for (let i = 0; i < parts.length - 1; i += 1) domains.push(`; domain=.${parts.slice(i).join(".")}`);
  return gaCookieNames(cookieString).flatMap((name) => domains.map((domain) => `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${domain}`));
}
