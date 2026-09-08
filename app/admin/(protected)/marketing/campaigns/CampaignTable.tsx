import Link from "next/link";
import { Badge } from "../../../../../components/admin/ui";
import { CHANNEL_LABELS } from "../../../../../lib/marketing/campaigns";
import type { MarketingCampaign } from "../../../../../lib/supabase/database.types";

function formatDate(d: string | null) {
  return d ? new Date(d).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" }) : "—";
}
function formatMoney(v: number | null) {
  return v != null ? `RM ${Number(v).toLocaleString("en-MY", { minimumFractionDigits: 2 })}` : "—";
}

/**
 * Desktop table + mobile card fallback — reuses the exact `.ta-lead-cards`
 * mechanism Leads/Opportunities/Quotations already share (admin.css's rules
 * for those classes are unscoped, not Sales-specific), rather than inventing
 * a new responsive table pattern for Marketing.
 */
export function CampaignTable({
  rows,
  staffNames,
  courseTitles,
}: {
  rows: MarketingCampaign[];
  staffNames: Map<string, string>;
  courseTitles: Map<string, string>;
}) {
  return (
    <>
      <div className="ta-table-wrap ta-mkt-table">
        <table className="ta-table">
          <thead>
            <tr>
              <th>Campaign</th>
              <th>Channel</th>
              <th>Status</th>
              <th>Period</th>
              <th>Budget</th>
              <th>Owner</th>
              <th>Course</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td>
                  <code style={{ fontSize: 12 }}>{c.campaign_number}</code>
                  <div>
                    <strong>{c.name}</strong>
                  </div>
                </td>
                <td>{CHANNEL_LABELS[c.channel]}</td>
                <td>
                  <Badge status={c.status} />
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {formatDate(c.start_date)} – {formatDate(c.end_date)}
                </td>
                <td>{formatMoney(c.budget)}</td>
                <td>{c.owner_id ? staffNames.get(c.owner_id) ?? "—" : <span className="ta-lead-sub">Unassigned</span>}</td>
                <td>{c.course_id ? courseTitles.get(c.course_id) ?? "—" : "—"}</td>
                <td style={{ textAlign: "right" }}>
                  <Link href={`/admin/marketing/campaigns/${c.id}`} className="ta-btn ta-btn-outline ta-btn-sm">
                    View
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="ta-lead-cards">
        {rows.map((c) => (
          <li className="ta-card ta-lead-card" key={c.id}>
            <div className="ta-lead-card-top">
              <code style={{ fontSize: 12 }}>{c.campaign_number}</code>
              <Badge status={c.status} />
            </div>
            <div className="ta-lead-card-company">
              <strong>{c.name}</strong>
              <div className="ta-lead-sub">{CHANNEL_LABELS[c.channel]}</div>
            </div>
            <div className="ta-lead-card-grid">
              <span>Period</span>
              <span>
                {formatDate(c.start_date)} – {formatDate(c.end_date)}
              </span>
              <span>Budget</span>
              <span>{formatMoney(c.budget)}</span>
              <span>Owner</span>
              <span>{c.owner_id ? staffNames.get(c.owner_id) ?? "—" : "Unassigned"}</span>
              <span>Course</span>
              <span>{c.course_id ? courseTitles.get(c.course_id) ?? "—" : "—"}</span>
            </div>
            <div className="ta-lead-card-action" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Link href={`/admin/marketing/campaigns/${c.id}`} className="ta-btn ta-btn-outline ta-btn-sm">
                View campaign →
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
