import { companyProfile } from "../../data/companyProfile";
import { accreditationRows } from "./recognitionStatus";
import kit from "../premium/premium.module.css";

// The first accreditation (JKKP) carries the dated recognition, so it leads. Its wording, and whether it still
// counts as current, come from accreditationRows(): after the validity date the tile states the recognition
// was valid until then, and it no longer counts towards the number of bodies.
export default function Recognition() {
  const rows = accreditationRows();
  const [lead, ...others] = rows;
  const currentCount = rows.filter((row) => row.current).length;
  return (
    <section id="recognition" className={`${kit.sec} ${kit.trust}`} aria-labelledby="recognition-title">
      <div className={kit.wrap}>
        <div className={kit.kicker}>
          <h2 id="recognition-title">Approved and registered</h2>
          <p>Established {companyProfile.established}. Approved and registered with {currentCount} bodies.</p>
        </div>
        <div className={kit.reg}>
          <div className={kit.lead}>
            <b>{lead.org}</b>
            <p>{lead.status}</p>
          </div>
          <ul className={kit.others}>
            {others.map((row) => (
              <li key={row.org}><b>{row.org}</b><span>{row.status}</span></li>
            ))}
          </ul>
        </div>
        <div className={kit.verify}>
          <span>Verify a certificate issued by TERAS UNIVERSAL.</span>
          <a className={`${kit.btn} ${kit.btnNavy}`} href="/verify">Check a TERAS certificate <span aria-hidden="true">&rarr;</span></a>
        </div>
      </div>
    </section>
  );
}
