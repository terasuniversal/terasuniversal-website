import Link from "next/link";
import { Badge } from "../../../../../components/admin/ui";
import { FollowUpBadge } from "../../../../../components/admin/sales/FollowUpBadge";
import { SOURCE_LABELS, followUpState, type SalesLeadInboxRow } from "../../../../../lib/sales/crm";
import { formatMalaysiaDate } from "../../../../../lib/date-time";

/** Server component — the Lead Inbox has no bulk actions in V1, so no client state is needed. */
export function LeadInboxTable({
  rows,
  staffNames,
}: {
  rows: SalesLeadInboxRow[];
  staffNames: Map<string, string>;
}) {
  return (
    <>
      <div className="ta-table-wrap ta-lead-table">
        <table className="ta-table">
          <thead>
            <tr>
              <th>Source</th>
              <th>Contact / Company</th>
              <th>Email / Phone</th>
              <th>Subject</th>
              <th>Status</th>
              <th>Assigned To</th>
              <th>Follow-up</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.lead_metadata_id}>
                <td><span className={`ta-badge-pill ta-source ta-source-${r.lead_source}`}>{SOURCE_LABELS[r.lead_source]}</span></td>
                <td>
                  <strong>{r.contact_name ?? "—"}</strong>
                  {r.company && <div className="ta-lead-sub">{r.company}</div>}
                </td>
                <td>
                  <div>{r.email ?? "—"}</div>
                  {r.phone && <div className="ta-lead-sub">{r.phone}</div>}
                </td>
                <td>{r.subject ?? "—"}</td>
                <td>
                  <Badge status={r.status} />
                  {r.is_test && <span className="ta-badge-pill" style={{ background: "#f4f5f7", color: "#667085", marginLeft: 4 }}>Test</span>}
                </td>
                <td>{r.assigned_to ? staffNames.get(r.assigned_to) ?? "—" : <span className="ta-lead-sub">Unassigned</span>}</td>
                <td>
                  <FollowUpBadge state={followUpState(r.follow_up_at, r.status)} />
                  {r.follow_up_at && <div className="ta-lead-sub">{formatMalaysiaDate(r.follow_up_at)}</div>}
                </td>
                <td className="ta-lead-sub" style={{ whiteSpace: "nowrap" }}>
                  {formatMalaysiaDate(r.created_at)}
                </td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <Link href={`/admin/sales/leads/${r.lead_metadata_id}`} className="ta-btn ta-btn-outline ta-btn-sm">View</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="ta-lead-cards">
        {rows.map((r) => (
          <li className="ta-card ta-lead-card" key={r.lead_metadata_id}>
            <div className="ta-lead-card-top">
              <span className={`ta-badge-pill ta-source ta-source-${r.lead_source}`}>{SOURCE_LABELS[r.lead_source]}</span>
              <span>
                <Badge status={r.status} />
                {r.is_test && <span className="ta-badge-pill" style={{ background: "#f4f5f7", color: "#667085", marginLeft: 4 }}>Test</span>}
              </span>
            </div>
            <div className="ta-lead-card-company">
              <strong>{r.contact_name ?? "—"}</strong>
              {r.company && <div className="ta-lead-sub">{r.company}</div>}
            </div>
            <div className="ta-lead-card-grid">
              <span>Email</span>
              <span>{r.email ?? "—"}</span>
              <span>Phone</span>
              <span>{r.phone ?? "—"}</span>
              <span>Subject</span>
              <span>{r.subject ?? "—"}</span>
              <span>Assigned To</span>
              <span>{r.assigned_to ? staffNames.get(r.assigned_to) ?? "—" : "Unassigned"}</span>
              <span>Follow-up</span>
              <span>
                <FollowUpBadge state={followUpState(r.follow_up_at, r.status)} />
                {r.follow_up_at && <div className="ta-lead-sub">{formatMalaysiaDate(r.follow_up_at)}</div>}
              </span>
              <span>Created</span>
              <span>{formatMalaysiaDate(r.created_at)}</span>
            </div>
            <div className="ta-lead-card-action">
              <Link href={`/admin/sales/leads/${r.lead_metadata_id}`} className="ta-btn ta-btn-outline ta-btn-sm">View lead →</Link>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
