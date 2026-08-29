import Link from "next/link";
import { Badge } from "../../../../../components/admin/ui";
import { SOURCE_LABELS, CONSENT_LABELS, contactDisplayName } from "../../../../../lib/marketing/contacts";
import type { MarketingContact } from "../../../../../lib/supabase/database.types";

function formatDate(d: string | null) {
  return d ? new Date(d).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" }) : "—";
}
function formatDateTime(d: string | null) {
  return d ? new Date(d).toLocaleString("en-MY", { dateStyle: "medium", timeStyle: "short" }) : "—";
}

/**
 * Desktop table + mobile card fallback — reuses the exact `.ta-lead-cards`
 * mechanism CampaignTable already reuses (admin.css's rules for those
 * classes are unscoped, not Sales-specific), plus a new module-specific
 * `.ta-contacts-table` hide-at-760px rule mirroring `.ta-mkt-table`
 * exactly.
 */
export function ContactTable({
  rows,
  staffNames,
}: {
  rows: MarketingContact[];
  staffNames: Map<string, string>;
}) {
  return (
    <>
      <div className="ta-table-wrap ta-contacts-table">
        <table className="ta-table">
          <thead>
            <tr>
              <th>Contact</th>
              <th>Source</th>
              <th>Status</th>
              <th>Consent</th>
              <th>Owner</th>
              <th>Next Follow-up</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td>
                  <code style={{ fontSize: 12 }}>{c.contact_number}</code>
                  <div>
                    <strong>{contactDisplayName(c)}</strong>
                  </div>
                  <div className="ta-lead-sub">{c.email ?? c.phone ?? "—"}</div>
                </td>
                <td>{SOURCE_LABELS[c.source]}</td>
                <td>
                  <Badge status={c.status} />
                </td>
                <td>
                  <Badge status={c.consent_status} />
                </td>
                <td>{c.owner_id ? staffNames.get(c.owner_id) ?? "—" : <span className="ta-lead-sub">Unassigned</span>}</td>
                <td style={{ whiteSpace: "nowrap" }}>{formatDateTime(c.next_follow_up_at)}</td>
                <td style={{ color: "var(--ta-muted)" }}>{formatDate(c.created_at)}</td>
                <td style={{ textAlign: "right" }}>
                  <Link href={`/admin/marketing/contacts/${c.id}`} className="ta-btn ta-btn-outline ta-btn-sm">
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
              <code style={{ fontSize: 12 }}>{c.contact_number}</code>
              <Badge status={c.status} />
            </div>
            <div className="ta-lead-card-company">
              <strong>{contactDisplayName(c)}</strong>
              <div className="ta-lead-sub">{c.email ?? c.phone ?? "—"}</div>
            </div>
            <div className="ta-lead-card-grid">
              <span>Source</span>
              <span>{SOURCE_LABELS[c.source]}</span>
              <span>Consent</span>
              <span>{CONSENT_LABELS[c.consent_status]}</span>
              <span>Owner</span>
              <span>{c.owner_id ? staffNames.get(c.owner_id) ?? "—" : <span className="ta-lead-sub">Unassigned</span>}</span>
              <span>Next Follow-up</span>
              <span>{formatDateTime(c.next_follow_up_at)}</span>
            </div>
            <div className="ta-lead-card-action" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Link href={`/admin/marketing/contacts/${c.id}`} className="ta-btn ta-btn-outline ta-btn-sm">
                View contact →
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
