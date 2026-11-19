import type { PublicSchedule } from "./public-content";

// Presentation rules for public training sessions, for the homepage, course pages and the calendar.
// Adapted from the Premium A3 helper (feat/website-premium-a3-company-services @ 55022bf) with an explicit locale.
// Pure functions only: no data fetching, no caching and no change to the schedule contract. Every value shown comes from
// the schedule record; nothing here derives eligibility, discounts, tax or funding, and nothing invents a venue, capacity
// or availability. Since Phase S3 this is the single presentation policy for the homepage sessions section, the training
// calendar and the course-page session cards (describeSession below).

export type SessionKind = "open" | "enquiry" | "full";

/** Locales the helpers accept. English (Malaysia) is the only public language today; "ms-MY" is prepared for later. */
export type SessionLocale = "en-MY" | "ms-MY";
export const DEFAULT_SESSION_LOCALE: SessionLocale = "en-MY";

type SessionState = Pick<PublicSchedule, "status" | "capacity" | "available_seats" | "fee" | "registration_available">;

interface SessionText {
  feeUnit: string;
  feeEnquiry: string;
  feePendingShort: string;
  venuePending: string;
  kinds: Record<SessionKind, { pill: string; cta: string }>;
  /** Compact action labels for narrow buttons; the full wording stays in kinds[].cta and in the accessible name. */
  ctaShort: Record<SessionKind, string>;
  /** Sessions that can no longer be joined: by recorded status, or because the start date has passed. */
  closed: { cancelled: string; completed: string; in_progress: string; past: string; cta: string };
  fullyBooked: string;
  seatsOnEnquiry: string;
  seats: (count: number) => string;
}

// Public copy. Only English is approved; a Bahasa Melayu entry is added here once the owner approves the translation, and
// until then "ms-MY" falls back to English rather than showing unapproved wording.
const TEXT: Partial<Record<SessionLocale, SessionText>> & { "en-MY": SessionText } = {
  "en-MY": {
    feeUnit: "per participant",
    feeEnquiry: "Fee to be confirmed",
    feePendingShort: "To be confirmed",
    venuePending: "Venue to be confirmed",
    kinds: {
      open: { pill: "Registration open", cta: "Register" },
      enquiry: { pill: "Open for enquiry", cta: "Enquire about this session" },
      full: { pill: "Full", cta: "Ask about the next date" },
    },
    ctaShort: { open: "Register", enquiry: "Enquire", full: "Ask about next date" },
    closed: { cancelled: "Cancelled", completed: "Completed", in_progress: "In progress", past: "Past session", cta: "View course details" },
    fullyBooked: "Fully booked",
    seatsOnEnquiry: "Confirmed on enquiry",
    seats: (count) => `${count} ${count === 1 ? "seat" : "seats"} available`,
  },
};

export function sessionText(locale: SessionLocale = DEFAULT_SESSION_LOCALE): SessionText {
  return TEXT[locale] ?? TEXT["en-MY"];
}

// English constants under the names the A3 components and contract test already use, so they can be adopted unchanged.
export const FEE_UNIT = TEXT["en-MY"].feeUnit;
export const FEE_ENQUIRY_TEXT = TEXT["en-MY"].feeEnquiry;
export const KIND_LABELS = TEXT["en-MY"].kinds;

/** A fee counts as confirmed only when it is a positive finite number. Null, zero, negative and non-numeric values are not prices. */
export function confirmedFee(fee: number | null | undefined): number | null {
  return typeof fee === "number" && Number.isFinite(fee) && fee > 0 ? fee : null;
}

// Grouping and decimals are written out here instead of relying on Intl, so the output is identical on every server and
// browser regardless of ICU data. Both supported locales use "," for thousands and "." for decimals in MYR amounts.
function groupThousands(whole: number): string {
  return String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** "RM 1,234" for whole amounts, "RM 1,234.50" otherwise; null when the fee is not confirmed. The unit is added by the caller. */
export function formatSessionFee(fee: number | null | undefined, _locale: SessionLocale = DEFAULT_SESSION_LOCALE): string | null {
  const value = confirmedFee(fee);
  if (value === null) return null;
  if (Number.isInteger(value)) return `RM ${groupThousands(value)}`;
  const cents = Math.round(value * 100);
  return `RM ${groupThousands(Math.floor(cents / 100))}.${String(cents % 100).padStart(2, "0")}`;
}

/**
 * Authoritative contract (get_public_registration_schedule and create_public_registration, migration public_registration_positive_fee_only):
 * registration_available is true only for a published, open session that has not started, whose fee is a positive amount,
 * with capacity greater than seats taken plus live holds. The server never registers a full session or a null or zero fee.
 *
 * "open" (Register) therefore requires the server flag AND a confirmed positive fee AND at least one seat AND a status other
 * than full. The extra checks only withhold the Register link from a stale or inconsistent record; they never grant
 * registration beyond the server flag. A full session (by status or by seats) is "full"; everything else is enquiry-only.
 */
export function sessionKind(session: SessionState): SessionKind {
  if (session.registration_available === true && session.status !== "full" && confirmedFee(session.fee) !== null && session.available_seats >= 1) return "open";
  if (session.status === "full" || (session.capacity > 0 && session.available_seats <= 0)) return "full";
  return "enquiry";
}

/** Pill and call-to-action text for a session state. */
export function kindLabels(kind: SessionKind, locale: SessionLocale = DEFAULT_SESSION_LOCALE) {
  return sessionText(locale).kinds[kind];
}

/** Server-provided availability as text: a seat count is only quoted for sessions that are open for registration. */
export function seatsText(session: Pick<PublicSchedule, "available_seats">, kind: SessionKind, locale: SessionLocale = DEFAULT_SESSION_LOCALE): string {
  const text = sessionText(locale);
  if (kind === "full") return text.fullyBooked;
  if (kind === "open" && session.available_seats > 0) return text.seats(session.available_seats);
  return text.seatsOnEnquiry;
}

const MONTHS: Record<SessionLocale, readonly string[]> = {
  "en-MY": ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  // Standard Malay month abbreviations; used only once Bahasa Melayu pages exist.
  "ms-MY": ["Jan", "Feb", "Mac", "Apr", "Mei", "Jun", "Jul", "Ogo", "Sep", "Okt", "Nov", "Dis"],
};

function parts(date: string): { y: number; m: number; d: number } {
  const [y, m, d] = date.split("-").map(Number);
  return { y, m: m - 1, d };
}

/**
 * "2 Dec 2026", "15–16 Nov 2026", "30 Nov – 2 Dec 2026" or "30 Dec 2026 – 2 Jan 2027".
 * Schedule dates are plain calendar dates (YYYY-MM-DD), so no time zone or Date object is involved and the result is the same everywhere.
 */
export function formatSessionDates(start: string, end?: string | null, locale: SessionLocale = DEFAULT_SESSION_LOCALE): string {
  const months = MONTHS[locale] ?? MONTHS["en-MY"];
  const a = parts(start);
  if (!end || end === start) return `${a.d} ${months[a.m]} ${a.y}`;
  const b = parts(end);
  if (a.y === b.y && a.m === b.m) return `${a.d}–${b.d} ${months[a.m]} ${a.y}`;
  if (a.y === b.y) return `${a.d} ${months[a.m]} – ${b.d} ${months[b.m]} ${a.y}`;
  return `${a.d} ${months[a.m]} ${a.y} – ${b.d} ${months[b.m]} ${b.y}`;
}

/** "8:30 am" from "08:30:00"; null when there is no valid start time. The 12-hour English form is used until a Malay form is approved. */
export function formatSessionTime(time: string | null | undefined, _locale: SessionLocale = DEFAULT_SESSION_LOCALE): string | null {
  if (!time) return null;
  const [h, m] = time.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

/** Delivery mode and venue as one line, exactly as recorded; the "to be confirmed" text when neither is set. */
export function formatSessionVenue(session: Pick<PublicSchedule, "delivery_mode" | "venue">, locale: SessionLocale = DEFAULT_SESSION_LOCALE): string {
  return [session.delivery_mode, session.venue].filter(Boolean).join(" · ") || sessionText(locale).venuePending;
}

/** "15 Nov": day and month of a calendar date, for the large date in session rows. */
export function formatSessionDay(date: string, locale: SessionLocale = DEFAULT_SESSION_LOCALE): string {
  const months = MONTHS[locale] ?? MONTHS["en-MY"];
  const a = parts(date);
  return `${a.d} ${months[a.m]}`;
}

const CLOSED_STATUSES = new Set(["cancelled", "completed", "in_progress"]);

/**
 * What the visitor can do with a session. "register" links to the existing registration route; "enquire" is resolved by
 * the page with the existing enquiryHref() so the enquiry URL format stays in one place; "details" is for sessions that can
 * no longer be joined (the page links the course when it knows it).
 */
export type SessionAction =
  | { type: "register"; href: string; label: string; shortLabel: string }
  | { type: "enquire"; label: string; shortLabel: string }
  | { type: "details"; label: string; shortLabel: string };

export interface SessionPresentation {
  /** Register / Full / Enquire decision (sessionKind), or "closed" for cancelled, completed, in-progress and past sessions. */
  state: SessionKind | "closed";
  statusLabel: string;
  /** Stable key for styling the status: open, full, enquiry, cancelled, completed or in_progress (a past session is completed). */
  statusKey: SessionKind | "cancelled" | "completed" | "in_progress";
  dateText: string;
  dayText: string;
  timeText: string | null;
  venueText: string;
  venueConfirmed: boolean;
  /** "RM 1,500" or null; null means the fee is not confirmed and must not be shown as a price. */
  feeAmount: string | null;
  feeUnit: string;
  /** "RM 1,500 per participant" or "Fee to be confirmed". */
  feeText: string;
  /** "To be confirmed" when there is no confirmed fee, for layouts that already label the field "Fee". */
  feeShort: string;
  seatsText: string;
  action: SessionAction;
}

type DescribedSession = SessionState & Pick<PublicSchedule, "id" | "start_date" | "end_date" | "start_time" | "venue" | "delivery_mode">;

/**
 * The shared session policy: every page that lists public sessions takes its labels, fee text, venue fallback, availability
 * and call to action from here, so the homepage, the calendar and the course pages cannot disagree.
 * `today` (YYYY-MM-DD) marks sessions that have already started as closed; pages that only list upcoming sessions may omit it.
 * Registration is never offered for a closed session, and otherwise only when sessionKind() returns "open", which itself
 * requires the server's registration_available flag.
 */
export function describeSession(session: DescribedSession, options: { locale?: SessionLocale; today?: string } = {}): SessionPresentation {
  const locale = options.locale ?? DEFAULT_SESSION_LOCALE;
  const text = sessionText(locale);
  const amount = formatSessionFee(session.fee, locale);
  const venueConfirmed = Boolean(session.delivery_mode || session.venue);
  const common = {
    dateText: formatSessionDates(session.start_date, session.end_date, locale),
    dayText: formatSessionDay(session.start_date, locale),
    timeText: formatSessionTime(session.start_time, locale),
    venueText: formatSessionVenue(session, locale),
    venueConfirmed,
    feeAmount: amount,
    feeUnit: text.feeUnit,
    feeText: amount ? `${amount} ${text.feeUnit}` : text.feeEnquiry,
    feeShort: amount ?? text.feePendingShort,
  };
  const past = options.today !== undefined && session.start_date < options.today;
  if (CLOSED_STATUSES.has(session.status) || past) {
    const label = CLOSED_STATUSES.has(session.status) ? text.closed[session.status as "cancelled" | "completed" | "in_progress"] : text.closed.past;
    const statusKey = session.status === "cancelled" || session.status === "in_progress" ? session.status : "completed";
    return { ...common, state: "closed", statusLabel: label, statusKey, seatsText: label, action: { type: "details", label: text.closed.cta, shortLabel: text.closed.cta } };
  }
  const kind = sessionKind(session);
  const labels = text.kinds[kind];
  const action: SessionAction = kind === "open"
    ? { type: "register", href: `/registration/${session.id}`, label: labels.cta, shortLabel: text.ctaShort.open }
    : { type: "enquire", label: labels.cta, shortLabel: text.ctaShort[kind] };
  return { ...common, state: kind, statusLabel: labels.pill, statusKey: kind, seatsText: seatsText(session, kind, locale), action };
}
