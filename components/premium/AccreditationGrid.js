import { accreditations } from "../../data/companyProfile";
import { accreditationRows } from "../home/recognitionStatus";
import CardGrid from "./CardGrid";

// Accreditation cards for the company pages. The JKKP card uses the same verified logic as the homepage: it states
// the scoped, dated training-centre recognition while it is current and only the ended period afterwards. The
// broader profile sentence is not shown for JKKP, so the card never implies cover for every TERAS programme.
// Other bodies keep their approved profile wording. The status is worked out at render time, so pages using this
// component must revalidate (export const revalidate) or the expiry would be frozen at build time.
export default function AccreditationGrid({ label }) {
  const rows = accreditationRows();
  const items = accreditations.map((entry, index) => {
    const row = rows[index];
    if (!entry.recognition) return { label: entry.org, title: entry.label, text: entry.text };
    return { label: entry.org, title: row.label ?? "Training centre recognition", text: row.detail };
  });
  return <CardGrid items={items} label={label} />;
}
