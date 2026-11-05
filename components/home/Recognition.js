import { companyProfile } from "../../data/companyProfile";
import { accreditationRows } from "./recognitionStatus";
import styles from "./home.module.css";

export default function Recognition() {
  const rows = accreditationRows();
  const currentCount = rows.filter((row) => row.current).length;
  return (
    <section id="recognition" className={styles.recog} aria-labelledby="recognition-title">
      <div className={styles.axis}>
        <h2 id="recognition-title" className={styles.h2}>Approved and registered</h2>
        <p className={styles.introLight}>Established {companyProfile.established}. Approved and registered with {currentCount} bodies.</p>
      </div>
      <table className={styles.table} role="table">
        <thead role="rowgroup">
          <tr role="row"><th role="columnheader">Body</th><th role="columnheader">Status</th></tr>
        </thead>
        <tbody role="rowgroup">
          {rows.map((row) => (
            <tr role="row" key={row.org}>
              <td role="cell" className={styles.bodyName}>{row.org}</td>
              <td role="cell">{row.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={styles.recogLink}><a className={styles.tlGold} href="/verify">Check a TERAS certificate</a></p>
    </section>
  );
}
