import Link from "next/link";
import { Badge } from "../../../../../../components/admin/ui";
import { formatMalaysiaDateTime } from "../../../../../../lib/date-time";
import type { DuplicateLeadMatch } from "../../../../../../lib/sales/duplicate-lead";

const REASON_LABELS = { email: "same email", phone: "same phone number" } as const;

/**
 * S-05 advisory notice. Non-blocking by design: it never stops work on this lead
 * and offers no merge/delete action. Only leads the viewer can already open
 * (RLS-filtered) are listed, and only their name, company, status and date.
 */
export function PotentialDuplicateNotice({ matches, failed }: { matches: DuplicateLeadMatch[]; failed: boolean }) {
  if (failed) {
    return (
      <p className="ta-alert" role="status" data-duplicate-check="unavailable" style={{ margin: "0 0 16px", fontSize: 13 }}>
        The duplicate-lead check could not run. Search the Leads list for this email or phone before creating a new lead or opportunity.
      </p>
    );
  }
  if (matches.length === 0) return null;
  return (
    <section
      className="ta-alert ta-alert-warning"
      role="status"
      aria-labelledby="possible-duplicate-title"
      data-duplicate-count={matches.length}
      style={{ margin: "0 0 16px" }}
    >
      <strong id="possible-duplicate-title" style={{ display: "block", marginBottom: 4 }}>
        Possible duplicate lead{matches.length > 1 ? "s" : ""} ({matches.length})
      </strong>
      <p style={{ margin: "0 0 8px", fontSize: 13 }}>
        Another lead you can access has the same email or phone number. This is a warning only: repeat customers and
        separate enquiries are allowed. Open the other lead to check before converting or quoting. Nothing has been
        merged or changed.
      </p>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
        {matches.map((match) => (
          <li key={match.leadId} style={{ marginBottom: 4 }}>
            <Link href={`/admin/sales/leads/${match.leadId}`}>{match.contactName ?? "Unnamed lead"}</Link>
            {match.company ? ` — ${match.company}` : ""} · <Badge status={match.status} />
            {match.isTest ? " · Test/Demo" : ""} · created {formatMalaysiaDateTime(match.createdAt)} · {match.reasons.map((r) => REASON_LABELS[r]).join(" and ")}
          </li>
        ))}
      </ul>
    </section>
  );
}
