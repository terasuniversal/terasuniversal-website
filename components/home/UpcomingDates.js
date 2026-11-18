import { homeContent } from "../../content/en/home";
import kit from "../premium/premium.module.css";
import styles from "./sessions.module.css";

// Hybrid Premium V2 (R3) "Next public sessions" on the navy field. Rows are prepared in app/page.js from
// getUpcomingSchedules() (at most three, earliest first) with lib/session-display.ts describeSession(), the policy the
// training calendar and course pages also use; this component only lays them out. Nothing here invents a date, venue,
// fee or seat count. id="upcoming-training" is the existing target of the header Register button and the hero link.
export default function UpcomingDates({ rows }) {
  const { sessions } = homeContent;
  return (
    <section id="upcoming-training" className={`${kit.px} ${kit.sec} ${kit.navyField} ${styles.sessions}`} aria-labelledby="sessions-title">
      <div className={kit.wrap}>
        <div className={styles.head}>
          <div>
            <h2 id="sessions-title">{sessions.title}</h2>
            <p className={styles.intro}>{sessions.intro}</p>
          </div>
          <a className={kit.tl} href={sessions.corporateLink.href}>{sessions.corporateLink.label}</a>
        </div>
        {rows.length > 0 ? (
          <ol className={styles.times}>
            {rows.map((row) => (
              <li className={styles.sess} key={row.id}>
                <span className={styles.d}>
                  <time dateTime={row.startDate}><b>{row.dayText}</b></time>
                  <span>{row.dateText}{row.timeText ? ` · ${row.timeText}` : ""}</span>
                </span>
                <span className={styles.c}>
                  <b>{row.courseHref ? <a className={styles.courseLink} href={row.courseHref}>{row.title}</a> : row.title}</b>
                  <span>{[row.duration, row.statusLabel].filter(Boolean).join(" · ")}</span>
                </span>
                <span className={styles.f}>
                  {sessions.venueLabel}
                  <b>{row.venueText}</b>
                </span>
                <span className={styles.f}>
                  {sessions.feeLabel}
                  <b>{row.feeShort}</b>
                  {row.feeAmount ? row.feeUnit : null}
                </span>
                <span className={styles.a}>
                  <a className={`${kit.btn} ${row.actionType === "register" ? "" : kit.btnLight}`} href={row.actionHref} aria-label={row.actionAria}>{row.actionLabel}</a>
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <div className={styles.empty}>
            <p><strong>{sessions.empty.title}</strong> {sessions.empty.text}</p>
          </div>
        )}
        <div className={styles.foot}>
          <a className={`${kit.tl} ${styles.all}`} href={sessions.viewAll.href}>{sessions.viewAll.label}</a>
          <a className={kit.tl} href={rows.length > 0 ? sessions.askLink.href : sessions.empty.cta.href}>{rows.length > 0 ? sessions.askLink.label : sessions.empty.cta.label}</a>
        </div>
      </div>
    </section>
  );
}
