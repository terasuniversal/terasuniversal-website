import styles from "./home.module.css";

// Rows are prepared in app/page.js from getUpcomingSchedules(), with the existing course-ID
// mapping and link rules, so the data and links are exactly what the homepage showed before.
export default function UpcomingDates({ rows }) {
  return (
    <div id="upcoming-training" className={styles.upcoming}>
      <h3 className={styles.h3}>Next public dates</h3>
      {rows.length > 0 ? (
        <ul className={styles.upList}>
          {rows.map((row) => (
            <li key={row.id}>
              <time dateTime={row.startDate} className={styles.upDate}>
                <strong>{row.dateText}</strong>
                {row.timeText && <span>{row.timeText}</span>}
              </time>
              <div className={styles.upInfo}>
                <span className={styles.upTitle}>{row.title}</span>
                <span className={styles.upMeta}>{row.meta}</span>
              </div>
              <span className={`${styles.upStatus} ${styles[`status_${row.status}`] ?? ""}`}>{row.statusLabel}</span>
              <a className={styles.tl} href={row.href}>{row.linkLabel}</a>
            </li>
          ))}
        </ul>
      ) : (
        <div className={styles.upEmpty}>
          <p>Upcoming dates are being confirmed. Share your preferred timing and we will propose a plan.</p>
        </div>
      )}
      <p className={styles.upLinks}>
        {rows.length === 0 && <a className={styles.tl} href="/request-proposal">Request a proposal</a>}
        <a className={styles.tl} href="/calendar">View full training calendar</a>
      </p>
    </div>
  );
}
