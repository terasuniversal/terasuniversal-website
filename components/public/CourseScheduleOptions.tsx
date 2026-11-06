import Link from "next/link";
import type { PublicSchedule } from "../../lib/public-content";
import { FEE_ENQUIRY_TEXT, FEE_UNIT, KIND_LABELS, formatSessionDates, formatSessionFee, formatSessionVenue, sessionKind } from "../../lib/session-display";
import kit from "../premium/premium.module.css";
import inner from "../premium/inner.module.css";
import SectionHead from "../premium/SectionHead";
import { enquiryHref } from "./PrimaryCtaGroup";

const pillClass = { open: inner.pillOpen, enquiry: "", full: inner.pillFull };

// Same sessions and contract as before; only the presentation follows the shared session rules (lib/session-display.ts).
// Registration is offered only for the "open" state (server flag registration_available, a positive fee and a seat). A fee that is null
// or zero is shown as an enquiry-based state, never as a free session.
export default function CourseScheduleOptions({ sessions, loadError = false, courseSlug }: { sessions: PublicSchedule[]; loadError?: boolean; courseSlug?: string }) {
  if (loadError) return <section className={kit.sec} aria-labelledby="course-schedule-title"><div className={kit.wrap}><SectionHead id="course-schedule-title" eyebrow="Upcoming Training" title="Training dates are temporarily unavailable.">Please try again shortly or contact TERAS for assistance.</SectionHead><a className={`${kit.btn} ${kit.btnNavy}`} href="/request-proposal">Contact TERAS</a></div></section>;
  if (!sessions.length) return null;
  return <section className={`${kit.sec} ${kit.trust}`} aria-labelledby="course-schedule-title"><div className={kit.wrap}><SectionHead id="course-schedule-title" eyebrow="Public Sessions" title="Choose a training date.">Review the available sessions below. Registration availability is checked from TERAS training records.</SectionHead><ul className={inner.sessions}>{sessions.map((session) => {
    const kind = sessionKind(session);
    const labels = KIND_LABELS[kind];
    const dates = formatSessionDates(session.start_date, session.end_date);
    const fee = formatSessionFee(session.fee);
    return <li className={inner.session} key={session.id}>
      <div><strong>{dates}</strong><span>{formatSessionVenue(session)}</span></div>
      <span>{fee ? `${fee} ${FEE_UNIT}` : FEE_ENQUIRY_TEXT}</span>
      <span className={`${inner.pill} ${pillClass[kind]}`}>{labels.pill}</span>
      {kind === "open"
        ? <Link className={`${kit.btn} ${kit.btnNavy}`} href={`/registration/${session.id}`} aria-label={`${labels.cta}: ${dates}`}>{labels.cta}</Link>
        : <a className={`${kit.btn} ${kit.btnNavy}`} href={enquiryHref({ course: courseSlug, session: session.start_date, source: "course-schedule" })} aria-label={`${labels.cta}: ${dates}`}>{labels.cta}</a>}
    </li>;
  })}</ul></div></section>;
}
