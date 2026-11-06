import type { PublicSchedule } from "./public-content";

// Presentation rules for public training sessions, shared by the homepage, course pages and the calendar.
// Pure functions only: no data fetching, no caching and no change to the schedule contract. A session fee is only ever
// read from the schedule record; nothing here derives eligibility, discounts, tax or funding from it.

export type SessionKind = "open" | "enquiry" | "full";

type SessionState = Pick<PublicSchedule, "status" | "capacity" | "available_seats" | "fee" | "registration_available">;

/** A fee counts as confirmed only when it is a positive number. Null, zero, negative and non-numeric values are not shown as prices. */
export function confirmedFee(fee: number | null | undefined): number | null {
  return typeof fee === "number" && Number.isFinite(fee) && fee > 0 ? fee : null;
}

const wholeMoney = new Intl.NumberFormat("en-MY", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const fractionMoney = new Intl.NumberFormat("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "RM 1,234" for whole amounts, "RM 1,234.50" otherwise; null when the fee is not confirmed. The unit ("per participant") is added by the caller. */
export function formatSessionFee(fee: number | null | undefined): string | null {
  const value = confirmedFee(fee);
  if (value === null) return null;
  return `RM ${Number.isInteger(value) ? wholeMoney.format(value) : fractionMoney.format(value)}`;
}

export const FEE_UNIT = "per participant";
export const FEE_ENQUIRY_TEXT = "Fee to be confirmed";

/**
 * Authoritative contract (get_public_registration_schedule and create_public_registration, migration public_registration_positive_fee_only):
 * registration_available is true only for a published, open session that has not started, whose fee is a positive amount (fee > 0),
 * with capacity greater than seats taken plus live holds. A session that is full, or has a null or zero fee, or no seat, is never
 * registrable on the server, and create_public_registration rejects fee <= 0 too. Online registration is paid-only; a zero or missing
 * fee is enquiry-only and there is no free-registration workflow.
 *
 * The "open" (Register) state here still requires the server flag AND a confirmed positive fee AND a seat (and a status other than full).
 * The positive-fee check is defence in depth: it never grants registration beyond the flag, it only withholds the Register link if a
 * stale or inconsistent record ever reached the page. Any other session is "full" (server says full or no seat remains) or enquiry-only.
 */
export function sessionKind(session: SessionState): SessionKind {
  if (session.registration_available === true && session.status !== "full" && confirmedFee(session.fee) !== null && session.available_seats >= 1) return "open";
  if (session.status === "full" || (session.capacity > 0 && session.available_seats <= 0)) return "full";
  return "enquiry";
}

export const KIND_LABELS: Record<SessionKind, { pill: string; cta: string }> = {
  open: { pill: "Registration open", cta: "Register" },
  enquiry: { pill: "Open for enquiry", cta: "Enquire about this session" },
  full: { pill: "Full", cta: "Ask about the next date" },
};

/** Server-provided availability as text: seats are only quoted for sessions that are open for registration. */
export function seatsText(session: Pick<PublicSchedule, "available_seats">, kind: SessionKind): string {
  if (kind === "full") return "Fully booked";
  if (kind === "open" && session.available_seats > 0) return `${session.available_seats} ${session.available_seats === 1 ? "seat" : "seats"} available`;
  return "Confirmed on enquiry";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parts(date: string): { y: number; m: number; d: number } {
  const [y, m, d] = date.split("-").map(Number);
  return { y, m: m - 1, d };
}

/** "2 Dec 2026", "15–16 Nov 2026", "30 Dec – 2 Jan 2027" or "30 Dec 2026 – 2 Jan 2027". Dates are plain calendar dates, so no time zone is involved. */
export function formatSessionDates(start: string, end?: string | null): string {
  const a = parts(start);
  if (!end || end === start) return `${a.d} ${MONTHS[a.m]} ${a.y}`;
  const b = parts(end);
  if (a.y === b.y && a.m === b.m) return `${a.d}–${b.d} ${MONTHS[a.m]} ${a.y}`;
  if (a.y === b.y) return `${a.d} ${MONTHS[a.m]} – ${b.d} ${MONTHS[b.m]} ${a.y}`;
  return `${a.d} ${MONTHS[a.m]} ${a.y} – ${b.d} ${MONTHS[b.m]} ${b.y}`;
}

/** "8:30 am" from "08:30:00"; null when there is no start time. */
export function formatSessionTime(time: string | null | undefined): string | null {
  if (!time) return null;
  const [h, m] = time.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

/** Delivery mode and venue as one line; the existing placeholder when neither is set. */
export function formatSessionVenue(session: Pick<PublicSchedule, "delivery_mode" | "venue">): string {
  return [session.delivery_mode, session.venue].filter(Boolean).join(" · ") || "Venue to be confirmed";
}
