import Link from "next/link";
import { Card, Badge } from "../ui";
import { getCertificateHistory } from "../../../lib/identity-correction/api";

// Read-only history of identity corrections for one certificate: who, when and which field -- never the values.
// NOT wired into app/admin/(protected)/certificates/[id]/page.tsx yet: that file differs between main and the CRM
// branch, so the one-line import belongs in the change that syncs the CRM branch with main. The caller must have
// passed requireRole("super_admin"); for anyone else the RPC refuses and this card renders nothing.
export default async function CorrectionHistoryCard({ certificateId }: { certificateId: string }) {
  const { data, error } = await getCertificateHistory(certificateId);
  if (error || !data || (data.requests.length === 0 && data.ledger.length === 0)) return null;

  const fmt = (v: string | null) => (v ? new Date(v).toLocaleString("en-MY", { dateStyle: "medium", timeStyle: "short" }) : "—");
  const fields = data.ledger.reduce<Record<string, string[]>>((acc, k) => {
    (acc[k.request_id] ??= []).push(k.field.replace(/_/g, " "));
    return acc;
  }, {});

  return (
    <Card title="Identity corrections">
      <div className="ta-table-wrap">
        <table className="ta-table">
          <thead><tr><th>Requested</th><th>Type</th><th>Status</th><th>Fields changed</th><th>Closed</th><th /></tr></thead>
          <tbody>
            {data.requests.map((r) => (
              <tr key={r.request_id}>
                <td>{fmt(r.requested_at)}</td>
                <td>{r.change_kind}</td>
                <td><Badge status={r.status === "applied" ? "completed" : r.status === "rejected" ? "revoked" : r.status} label={r.status} /></td>
                <td>{[...new Set(fields[r.request_id] ?? [])].join(", ") || "—"}</td>
                <td>{fmt(r.closed_at)}</td>
                <td><Link href={`/admin/certificates/identity-correction/${r.request_id}`} className="ta-btn ta-btn-outline ta-btn-sm">View</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
