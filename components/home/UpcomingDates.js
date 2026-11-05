import kit from "../premium/premium.module.css";

// Rows are prepared in app/page.js from getUpcomingSchedules(), with the existing course-ID
// mapping and link rules, so the data and links are exactly what the homepage showed before.
export default function UpcomingDates({ rows }) {
  return (
    <div id="upcoming-training" className={kit.dates}>
      <div>
        <h3>Next public dates</h3>
        <p className={kit.note}>Open sessions from the TERAS training calendar.</p>
      </div>
      <div>
        {rows.length > 0 ? (
          <ul className={kit.ledger}>
            {rows.map((row) => (
              <li key={row.id}>
                <time dateTime={row.startDate} className={kit.when}>
                  {row.dateText}
                  {row.timeText && <span>{row.timeText}</span>}
                </time>
                <div className={kit.what}>
                  <b>{row.title}</b>
                  <span>{row.meta}</span>
                </div>
                <span className={`${kit.pill} ${kit[`status_${row.status}`] ?? ""}`}>{row.statusLabel}</span>
                <a className={kit.tl} href={row.href}>{row.linkLabel}</a>
              </li>
            ))}
          </ul>
        ) : (
          <p className={kit.empty}>Upcoming dates are being confirmed. Share your preferred timing and we will propose a plan.</p>
        )}
        <p className={kit.links}>
          {rows.length === 0 && <a className={kit.tl} href="/request-proposal">Request a proposal</a>}
          <a className={kit.tl} href="/calendar">View full training calendar</a>
        </p>
      </div>
    </div>
  );
}
