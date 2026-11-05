import Link from "next/link";
import { Badge } from "../../../../../components/admin/ui";
import { FollowUpBadge } from "../../../../../components/admin/sales/FollowUpBadge";
import { PRIORITY_LABELS, SOURCE_LABELS, followUpState, type SalesLeadInboxRow } from "../../../../../lib/sales/crm";
import { formatMalaysiaDate } from "../../../../../lib/date-time";
import { ageLabel, daysSinceActivityLabel, qualificationLabel, temperatureLabel } from "../../../../../lib/sales/qualification";

type LeadNextAction = { id: string; title: string; status: string; priority: string; due_at: string | null };

/** Server component — the Lead Inbox has no bulk actions in V1, so no client state is needed. */
export function LeadInboxTable({
  rows,
  staffNames,
  staffNamesUnavailable = false,
  nextActions,
  qualificationByLead,
  lastActivityByLead,
}: {
  rows: SalesLeadInboxRow[];
  staffNames: Map<string, string>;
  staffNamesUnavailable?: boolean;
  nextActions: Map<string, LeadNextAction>;
  qualificationByLead: Map<string, { qualification_status: string; temperature: string | null }>;
  lastActivityByLead: Map<string, string>;
}) {
  return (
    <>
      <div className="ta-table-wrap ta-lead-table">
        <table className="ta-table">
          <thead>
            <tr>
              <th>Lead / Enquiry</th>
              <th>Source</th>
              <th>Status / Qualification</th>
              <th>Owner</th>
              <th>Follow-up</th>
              <th>Next Action</th>
              <th>Activity / Age</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.lead_metadata_id}>
                <td>
                  <Link href={`/admin/sales/leads/${r.lead_metadata_id}`} className="ta-sales-record-link"><strong>{r.contact_name ?? "Unnamed lead"}</strong></Link>
                  {r.company && <div className="ta-lead-sub">{r.company}</div>}
                  <div className="ta-lead-sub">{r.subject ?? "No enquiry subject"}</div>
                </td>
                <td><span className={`ta-badge-pill ta-source ta-source-${r.lead_source}`}>{SOURCE_LABELS[r.lead_source]}</span></td>
                <td>
                  <Badge status={r.status} />
                  {r.is_test && <span className="ta-badge-pill" style={{ background: "#f4f5f7", color: "#667085", marginLeft: 4 }}>Test</span>}
                  <div className="ta-lead-sub">{qualificationLabel(qualificationByLead.get(r.lead_metadata_id)?.qualification_status)} · {temperatureLabel(qualificationByLead.get(r.lead_metadata_id)?.temperature)}</div>
                </td>
                <td>{r.assigned_to ? staffNamesUnavailable ? <span className="ta-lead-sub">Owner unavailable</span> : staffNames.get(r.assigned_to) ?? "—" : <span className="ta-lead-sub">Unassigned</span>}</td>
                <td>
                  <FollowUpBadge state={followUpState(r.follow_up_at, r.status)} />
                  {r.follow_up_at && <div className="ta-lead-sub">{formatMalaysiaDate(r.follow_up_at)}</div>}
                </td>
                <td>
                  {nextActions.get(r.lead_metadata_id) ? (
                    <Link href={`/admin/sales/tasks/${nextActions.get(r.lead_metadata_id)!.id}`}>{nextActions.get(r.lead_metadata_id)!.title}</Link>
                  ) : <span className="ta-lead-sub">None</span>}
                  <div className="ta-lead-sub">Priority: {PRIORITY_LABELS[r.priority]}</div>
                </td>
                <td><div>{daysSinceActivityLabel(lastActivityByLead.get(r.lead_metadata_id) ?? null)}</div><div className="ta-lead-sub">Lead age {ageLabel(r.created_at)}</div></td>
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
          <li className="ta-card ta-lead-card ta-lead-m" key={r.lead_metadata_id}>
            <div className="ta-lead-m-head">
              <div className="ta-lead-m-id">
                <strong className="ta-lead-m-name">{r.contact_name ?? "—"}</strong>
                {r.company && <div className="ta-lead-sub">{r.company}</div>}
              </div>
              <div className="ta-lead-m-status">
                <Badge status={r.status} />
                {r.is_test && <span className="ta-badge-pill" style={{ background: "#f4f5f7", color: "#667085" }}>Test</span>}
              </div>
            </div>
            <p className="ta-lead-sub ta-lead-m-subject">{r.subject ?? "No enquiry subject"}</p>
            <div className="ta-lead-m-meta">
              <span className={`ta-badge-pill ta-source ta-source-${r.lead_source}`}>{SOURCE_LABELS[r.lead_source]}</span>
              <span className="ta-lead-m-chip">Qualification <b>{qualificationLabel(qualificationByLead.get(r.lead_metadata_id)?.qualification_status)}</b></span>
              <span className="ta-lead-m-chip">Temperature <b>{temperatureLabel(qualificationByLead.get(r.lead_metadata_id)?.temperature)}</b></span>
              <span className="ta-lead-m-chip">Priority <b>{PRIORITY_LABELS[r.priority]}</b></span>
            </div>
            <div className="ta-lead-card-grid ta-lead-m-grid">
              <span>Follow-up</span>
              <span>
                <FollowUpBadge state={followUpState(r.follow_up_at, r.status)} />
                {r.follow_up_at && <div className="ta-lead-sub">{formatMalaysiaDate(r.follow_up_at)}</div>}
              </span>
              <span>Next Action</span>
              <span>
                {nextActions.get(r.lead_metadata_id) ? (
                  <Link href={`/admin/sales/tasks/${nextActions.get(r.lead_metadata_id)!.id}`}>{nextActions.get(r.lead_metadata_id)!.title}</Link>
                ) : "None"}
              </span>
              <span>Owner</span>
              <span>{r.assigned_to ? staffNamesUnavailable ? "Owner unavailable" : staffNames.get(r.assigned_to) ?? "—" : "Unassigned"}</span>
              <span>Last activity</span><span>{daysSinceActivityLabel(lastActivityByLead.get(r.lead_metadata_id) ?? null)}</span>
            </div>
            <div className="ta-lead-card-action">
              <Link href={`/admin/sales/leads/${r.lead_metadata_id}`} className="ta-btn ta-btn-outline ta-btn-sm" aria-label={`View lead ${r.contact_name ?? r.company ?? ""}`.trim()}>View lead →</Link>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
