import { enquiryHref } from "../public/PrimaryCtaGroup";
import EmptyState from "../premium/EmptyState";
import kit from "../premium/premium.module.css";
import {
  FEE_ENQUIRY_TEXT,
  FEE_UNIT,
  KIND_LABELS,
  formatSessionDates,
  formatSessionFee,
  formatSessionTime,
  formatSessionVenue,
  seatsText,
  sessionKind,
} from "../../lib/session-display";
import styles from "./upcoming.module.css";

const PILL = { open: styles.pillOpen, enquiry: "", full: styles.pillFull };

// The section keeps the #upcoming-training anchor that existing links use. Sessions come from getUpcomingSchedulesWithState() in
// app/page.js (same RPC calls and cache lifetime as before, at most three). Registration is offered only when the server flag
// registration_available is true; the fee is shown exactly as the schedule provides it and never decides eligibility.
function SessionCard({ session }) {
  const kind = sessionKind(session);
  const labels = KIND_LABELS[kind];
  const dates = formatSessionDates(session.start_date, session.end_date);
  const time = formatSessionTime(session.start_time);
  const fee = formatSessionFee(session.fee);
  const href = kind === "open"
    ? `/registration/${session.id}`
    : enquiryHref({ course: session.courseSlug ?? undefined, session: session.start_date, source: "homepage-schedule" });
  return (
    <li className={styles.card}>
      <div className={styles.top}>
        <time dateTime={session.start_date} className={styles.date}>
          {dates}
          {time && <span className={styles.time}>{time}</span>}
        </time>
        <span className={`${styles.pill} ${PILL[kind]}`}>{labels.pill}</span>
      </div>
      <h3>{session.title}</h3>
      <dl className={styles.facts}>
        <div><dt>Venue</dt><dd>{formatSessionVenue(session)}</dd></div>
        <div>
          <dt>Fee</dt>
          <dd className={kind === "full" ? styles.fullFee : undefined}>
            {fee ? <><span className={styles.amount}>{fee}</span> <span className={styles.unit}>{FEE_UNIT}</span></> : <span className={styles.muted}>{FEE_ENQUIRY_TEXT}</span>}
          </dd>
        </div>
        <div><dt>Seats</dt><dd className={kind === "enquiry" ? styles.muted : undefined}>{seatsText(session, kind)}</dd></div>
      </dl>
      <div className={styles.actions}>
        <a className={kind === "open" ? kit.btn : `${kit.btn} ${kit.btnNavy}`} href={href} aria-label={`${labels.cta}: ${session.title}, ${dates}`}>{labels.cta}</a>
        {session.courseSlug && <a className={kit.tl} href={`/training/${session.courseSlug}`} aria-label={`Course details: ${session.title}`}>Course details</a>}
      </div>
    </li>
  );
}

export function UpcomingTrainingLoading() {
  return (
    <section id="upcoming-training" className={`${kit.sec} ${kit.trust}`} aria-labelledby="upcoming-training-title" aria-busy="true">
      <div className={kit.wrap}>
        <div className={kit.kicker}>
          <h2 id="upcoming-training-title">Upcoming training</h2>
          <p>Confirmed public sessions from the TERAS training calendar.</p>
        </div>
        <p className="sr-only" role="status">Loading upcoming training dates</p>
        <div className={styles.cards} aria-hidden="true">
          {[0, 1, 2].map((index) => <div className={styles.skel} key={index}><div className={styles.skelBar} /><div className={styles.skelBar} /><div className={styles.skelBar} /></div>)}
        </div>
      </div>
    </section>
  );
}

export default function UpcomingTraining({ sessions = [], unavailable = false }) {
  const shown = sessions.slice(0, 3);
  return (
    <section id="upcoming-training" className={`${kit.sec} ${kit.trust}`} aria-labelledby="upcoming-training-title">
      <div className={kit.wrap}>
        <div className={kit.kicker}>
          <h2 id="upcoming-training-title">Upcoming training</h2>
          <p>Confirmed public sessions from the TERAS training calendar.</p>
        </div>
        {unavailable ? (
          <EmptyState title="Training dates are temporarily unavailable." text="Please try again shortly or contact TERAS for assistance.">
            <a className={`${kit.btn} ${kit.btnNavy}`} href="/request-proposal">Contact TERAS</a>
          </EmptyState>
        ) : shown.length === 0 ? (
          <EmptyState title="Upcoming dates are being confirmed." text="Share your preferred timing and we will propose a plan.">
            <a className={`${kit.btn} ${kit.btnNavy}`} href="/request-proposal">Request a proposal</a>
          </EmptyState>
        ) : (
          <ul className={styles.cards} aria-label="Upcoming public training sessions">
            {shown.map((session) => <SessionCard session={session} key={session.id} />)}
          </ul>
        )}
        <p className={styles.foot}>
          <a className={kit.tl} href="/calendar">View full training calendar</a>
          {shown.length > 0 && !unavailable && <span>Fees are per participant and set for each session.</span>}
        </p>
      </div>
    </section>
  );
}
