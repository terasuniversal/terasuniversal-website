import Link from "next/link";
import { requireRole } from "../../../../../lib/auth/session";
import { PageHead, Card, Badge, EmptyState, ReadErrorState } from "../../../../../components/admin/ui";
import { getPolicy, listRequests, type RequestStatus } from "../../../../../lib/identity-correction/api";
import { identityCorrectionMessage } from "../../../../../lib/identity-correction/errors";

export const metadata = { title: "Identity corrections — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

const STATUSES: RequestStatus[] = ["pending", "applied", "rejected", "cancelled"];
// admin.css already styles these pill classes; map the four request states onto the closest existing ones.
const PILL: Record<RequestStatus, string> = { pending: "pending", applied: "completed", rejected: "revoked", cancelled: "cancelled" };
const KIND: Record<string, string> = { name: "Name", identity: "IC / Passport", combined: "Name and IC / Passport" };

function fmt(value: string | null) {
  return value ? new Date(value).toLocaleString("en-MY", { dateStyle: "medium", timeStyle: "short" }) : "—";
}

export default async function IdentityCorrectionsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireRole("super_admin");
  const sp = await searchParams;
  const status = STATUSES.find((s) => s === sp.status) ?? null;
  const [policy, requests] = await Promise.all([getPolicy(), listRequests(status)]);

  return (
    <div>
      <PageHead
        title="Identity corrections"
        subtitle="Correct a spelling error in the holder name or IC/Passport of an issued certificate. The certificate number, QR token and issue date never change."
        action={<Link href="/admin/certificates/identity-correction/new" className="ta-btn ta-btn-primary">+ New correction</Link>}
      />

      {policy.error ? (
        <ReadErrorState message={identityCorrectionMessage(policy.error)} />
      ) : policy.data && !policy.data.controls_ready ? (
        <div role="status" className="ta-alert ta-alert-error" style={{ marginBottom: 16 }}>
          Corrections are switched off. They stay off until the sealing key, the external audit anchor and the notification channel are configured and verified.
          New requests are refused until then.
        </div>
      ) : null}

      <form className="ta-toolbar" style={{ alignItems: "flex-end" }}>
        <div className="ta-field">
          <label htmlFor="status">Status</label>
          <select id="status" name="status" defaultValue={status ?? ""}>
            <option value="">All</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
          </select>
        </div>
        <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm">Apply</button>
      </form>

      <Card>
        {requests.error ? (
          <ReadErrorState message={identityCorrectionMessage(requests.error)} />
        ) : !requests.data || requests.data.length === 0 ? (
          <EmptyState title="No correction requests" message="Requests appear here once a Super Admin starts one." />
        ) : (
          <div className="ta-table-wrap">
            <table className="ta-table">
              <thead>
                <tr><th>Participant</th><th>Type</th><th>Certificates</th><th>Status</th><th>Requested</th><th>Earliest apply</th><th /></tr>
              </thead>
              <tbody>
                {requests.data.map((r) => (
                  <tr key={r.id}>
                    <td>{r.participant_code ?? "—"}</td>
                    <td>{KIND[r.change_kind] ?? r.change_kind}</td>
                    <td>{r.certificate_count}</td>
                    <td><Badge status={PILL[r.status]} label={r.status[0].toUpperCase() + r.status.slice(1)} /></td>
                    <td>{fmt(r.requested_at)}</td>
                    <td>{r.status === "pending" ? fmt(r.earliest_apply_at) : fmt(r.closed_at)}</td>
                    <td><Link href={`/admin/certificates/identity-correction/${r.id}`} className="ta-btn ta-btn-outline ta-btn-sm">View</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
