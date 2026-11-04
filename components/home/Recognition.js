import { accreditations, companyProfile } from "../../data/companyProfile";
import styles from "./home.module.css";

const longDate = (iso) => new Intl.DateTimeFormat("en-MY", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

// A dated recognition is stated as current only until the end of its last valid day (Malaysia time).
// After that it is stated as historical, and stays so until a renewal is verified and the data is updated.
const recognitionNote = (recognition) => {
  if (!recognition) return "";
  const current = Date.now() <= new Date(`${recognition.validUntil}T23:59:59+08:00`).getTime();
  const until = longDate(recognition.validUntil);
  return current
    ? `Recognised training centre for ${recognition.scope}, valid until ${until}.`
    : `Recognition as a training centre for ${recognition.scope} was valid until ${until}.`;
};

export default function Recognition() {
  return (
    <section id="recognition" className={styles.recog} aria-labelledby="recognition-title">
      <div className={styles.axis}>
        <h2 id="recognition-title" className={styles.h2}>Approved and registered</h2>
        <p className={styles.introLight}>Established {companyProfile.established}. Approved and registered with {accreditations.length} bodies.</p>
      </div>
      <table className={styles.table} role="table">
        <thead role="rowgroup">
          <tr role="row"><th role="columnheader">Body</th><th role="columnheader">Status</th></tr>
        </thead>
        <tbody role="rowgroup">
          {accreditations.map((entry) => (
            <tr role="row" key={entry.org}>
              <td role="cell" className={styles.bodyName}>{entry.org}</td>
              <td role="cell">{entry.label}{entry.recognition ? `. ${recognitionNote(entry.recognition)}` : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={styles.recogLink}><a className={styles.tlGold} href="/verify">Check a TERAS certificate</a></p>
    </section>
  );
}
