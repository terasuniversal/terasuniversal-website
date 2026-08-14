import Link from "next/link";
import { Badge } from "../../../../../components/admin/ui";
import { type SalesOpportunityRow } from "../../../../../lib/sales/crm";

export function OpportunityTable({
  rows,
  staffNames,
}: {
  rows: SalesOpportunityRow[];
  staffNames: Map<string, string>;
}) {
  return (
    <div className="ta-table-wrap">
      <table className="ta-table">
        <thead>
          <tr>
            <th>Opportunity No</th>
            <th>Company / Contact</th>
            <th>Source Lead</th>
            <th>Programme</th>
            <th>Stage</th>
            <th>Owner</th>
            <th>Expected Close</th>
            <th>Value</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td><code style={{ fontSize: 12 }}>{r.opportunity_no}</code></td>
              <td>
                <strong>{r.company_name ?? "—"}</strong>
                {r.contact_person && <div className="ta-lead-sub">{r.contact_person}</div>}
              </td>
              <td><Link href={`/admin/sales/leads/${r.lead_metadata_id}`} className="ta-btn ta-btn-outline ta-btn-sm">View Lead</Link></td>
              <td>{r.programme ?? "—"}</td>
              <td><Badge status={r.stage} /></td>
              <td>{r.assigned_to ? staffNames.get(r.assigned_to) ?? "—" : <span className="ta-lead-sub">Unassigned</span>}</td>
              <td style={{ whiteSpace: "nowrap" }}>
                {r.expected_close_date ? new Date(r.expected_close_date).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" }) : "—"}
              </td>
              <td>{r.estimated_value != null ? `RM ${Number(r.estimated_value).toLocaleString("en-MY", { minimumFractionDigits: 2 })}` : "—"}</td>
              <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                <Link href={`/admin/sales/opportunities/${r.id}`} className="ta-btn ta-btn-outline ta-btn-sm">View</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
