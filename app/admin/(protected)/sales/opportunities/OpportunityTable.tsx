import Link from "next/link";
import { Badge } from "../../../../../components/admin/ui";
import { formatMalaysiaDate, formatMalaysiaDateTime } from "../../../../../lib/date-time";
import { ageLabel, formatMoney, sinceActivityLabel } from "../../../../../lib/sales/opportunity-pipeline";
import type { OpportunityPipelineRow } from "./page";

function closeLabel(row: OpportunityPipelineRow): string {
  if (!row.expected_close_date) return "No date";
  if (row.expectedCloseState === "overdue") return `${formatMalaysiaDate(row.expected_close_date)} · Overdue`;
  if (row.expectedCloseState === "due_soon") return `${formatMalaysiaDate(row.expected_close_date)} · Due soon`;
  return formatMalaysiaDate(row.expected_close_date);
}

export function OpportunityTable({ rows, staffNames }: { rows: OpportunityPipelineRow[]; staffNames: Map<string, string> }) {
  return (
    <>
      <div className="ta-table-wrap ta-opp-table">
        <table className="ta-table">
          <thead><tr><th>Opportunity</th><th>Company / Contact</th><th>Stage</th><th>Owner</th><th>Value</th><th>Probability</th><th>Expected Close</th><th>Age</th><th>Last Activity</th><th>Next Action</th><th>Indicators</th><th /></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td><code style={{ fontSize: 12 }}>{row.opportunity_no}</code><div className="ta-lead-sub">{row.title}</div></td>
                <td><strong>{row.company_name ?? "—"}</strong>{row.contact_person && <div className="ta-lead-sub">{row.contact_person}</div>}</td>
                <td><Badge status={row.stage} /></td>
                <td>{row.assigned_to ? staffNames.get(row.assigned_to) ?? "—" : <span className="ta-lead-sub">Unassigned</span>}</td>
                <td style={{ whiteSpace: "nowrap" }}>{formatMoney(row.estimated_value)}</td>
                <td>{row.probability == null ? "—" : `${row.probability}%`}</td>
                <td style={{ whiteSpace: "nowrap" }}>{closeLabel(row)}</td>
                <td>{ageLabel(row.created_at)}</td>
                <td title={formatMalaysiaDateTime(row.lastActivityAt)}>{sinceActivityLabel(row.lastActivityAt, row.created_at)}</td>
                <td style={{ minWidth: 160 }}>{row.nextAction ? <><strong>{row.nextAction.title}</strong>{row.nextAction.due_at && <div className="ta-lead-sub">Due {formatMalaysiaDateTime(row.nextAction.due_at)}</div>}</> : <span className="ta-lead-sub">No active task</span>}</td>
                <td>{row.stalled && <Badge status="stalled" />}{row.expectedCloseState === "overdue" && <Badge status="overdue" />}</td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}><Link href={`/admin/sales/opportunities/${row.id}`} className="ta-btn ta-btn-outline ta-btn-sm">View</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="ta-lead-cards">
        {rows.map((row) => (
          <li className="ta-card ta-lead-card" key={row.id}>
            <div className="ta-lead-card-top"><code style={{ fontSize: 12 }}>{row.opportunity_no}</code><Badge status={row.stage} /></div>
            <div className="ta-lead-card-company"><strong>{row.company_name ?? "—"}</strong>{row.contact_person && <div className="ta-lead-sub">{row.contact_person}</div>}</div>
            <div className="ta-lead-card-grid">
              <span>Owner</span><span>{row.assigned_to ? staffNames.get(row.assigned_to) ?? "—" : "Unassigned"}</span>
              <span>Value</span><span>{formatMoney(row.estimated_value)}{row.probability != null ? ` · ${row.probability}%` : ""}</span>
              <span>Expected Close</span><span>{closeLabel(row)}</span>
              <span>Age / Activity</span><span>{ageLabel(row.created_at)} · {sinceActivityLabel(row.lastActivityAt, row.created_at)}</span>
              <span>Next Action</span><span>{row.nextAction?.title ?? "No active task"}</span>
            </div>
            {(row.stalled || row.expectedCloseState === "overdue") && <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>{row.stalled && <Badge status="stalled" />}{row.expectedCloseState === "overdue" && <Badge status="overdue" />}</div>}
            <div className="ta-lead-card-action"><Link href={`/admin/sales/leads/${row.lead_metadata_id}`} className="ta-btn ta-btn-outline ta-btn-sm">View Lead</Link><Link href={`/admin/sales/opportunities/${row.id}`} className="ta-btn ta-btn-outline ta-btn-sm">View Opportunity →</Link></div>
          </li>
        ))}
      </ul>
    </>
  );
}
