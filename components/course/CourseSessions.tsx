import Link from "next/link";
import type { PublicSchedule } from "../../lib/public-content";
import { describeSession } from "../../lib/session-display";
import { enquiryHref } from "../public/PrimaryCtaGroup";
import { courseContent } from "../../content/en/course";
import kit from "../premium/premium.module.css";
import styles from "./course.module.css";

// Course-page session cards (Phase S4B; replaces components/public/CourseScheduleOptions.tsx, which was used only here).
// Dates, venue fallback, fee text (zero and missing fees are never shown as a price), availability and the
// Register / Full / Enquire action come from the shared policy in lib/session-display.ts, the same one the homepage and
// the training calendar use. Register is offered only when the server's registration_available flag allows it. The page
// passes upcoming sessions only; a cancelled or in-progress one shows its status pill and nothing else, as in the calendar.
// Kept out of components/public/ so the public kit never sits next to the registration components.
export default function CourseSessions({ sessions, loadError = false, courseSlug }: { sessions: PublicSchedule[]; loadError?: boolean; courseSlug?: string }) {
  const text = courseContent.sessions;
  if (loadError) return (
    <section id="course-sessions" className={`${kit.px} ${kit.tone} ${styles.sessions}`} aria-labelledby="course-schedule-title">
      <div className={kit.wrap}>
        <div className={styles.state} role="alert">
          <p className={styles.eyebrow}>{text.unavailable.eyebrow}</p>
          <h2 id="course-schedule-title">{text.unavailable.title}</h2>
          <p>{text.unavailable.text}</p>
          <a className={kit.btn} href={text.unavailable.cta.href}>{text.unavailable.cta.label}</a>
        </div>
      </div>
    </section>
  );
  if (!sessions.length) return null;
  return (
    <section id="course-sessions" className={`${kit.px} ${kit.tone} ${styles.sessions}`} aria-labelledby="course-schedule-title">
      <div className={kit.wrap}>
        <p className={styles.eyebrow}>{text.eyebrow}</p>
        <h2 id="course-schedule-title">{text.title}</h2>
        <p className={styles.sectionText}>{text.text}</p>
        <ol className={styles.sessionList}>
          {sessions.map((session) => {
            const view = describeSession(session);
            const label = `${view.action.label}: ${session.title}, ${view.dateText}`;
            return (
              <li key={session.id}>
                <article className={`${styles.session} ${view.state === "closed" ? styles.closed : ""}`}>
                  <time className={styles.date} dateTime={session.start_date}>
                    <b>{view.dayText}</b>
                    <span>{view.dateText}{view.timeText ? ` · ${view.timeText}` : ""}</span>
                  </time>
                  <p className={styles.fact}>{text.venueLabel}<b>{view.venueText}</b></p>
                  {view.state !== "closed"
                    ? <p className={styles.fact}>{text.feeLabel}<b>{view.feeShort}</b>{view.feeAmount ? view.feeUnit : null}</p>
                    : <p className={styles.fact} aria-hidden="true" />}
                  <div className={styles.action}>
                    <span className={`${styles.pill} ${styles[`pill_${view.statusKey}`] ?? ""}`}>{view.state === "open" ? view.seatsText : view.statusLabel}</span>
                    {view.action.type === "register"
                      ? <Link className={kit.btn} href={view.action.href} aria-label={label}>{view.action.label}</Link>
                      : view.action.type === "enquire"
                        ? <a className={`${kit.btn} ${styles.btnLine}`} href={enquiryHref({ course: courseSlug, session: session.start_date, source: "course-schedule" })} aria-label={label}>{view.action.label}</a>
                        : null}
                  </div>
                </article>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
