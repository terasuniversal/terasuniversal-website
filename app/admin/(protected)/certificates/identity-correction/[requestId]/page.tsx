import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "../../../../../../lib/auth/session";
import { PageHead, Card, Badge, ReadErrorState } from "../../../../../../components/admin/ui";
import { getRequest, type RequestStatus } from "../../../../../../lib/identity-correction/api";
import { identityCorrectionMessage } from "../../../../../../lib/identity-correction/errors";
import RequestActions from "./RequestActions";

export const metadata = { title: "Identity correction — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PILL: Record<RequestStatus, string> = { pending: "pending", applied: "completed", rejected: "revoked", cancelled: "cancelled" };
const KIND: Record<string, string> = { name: "Name", identity: "IC / Passport", combined: "Name and IC / Passport" };
const DECISION: Record<string, string> = {
  correct: "Correct", leave: "Leave as issued", accept_display_change: "Show the new number (live from profile)",
  pin_old: "Keep the old number", materialize_new: "Store the new number",
};

const fmt = (v: string | null) => (v ? new Date(v).toLocaleString("en-MY", { dateStyle: "medium", timeStyle: "short" }) : "—");

export default async function IdentityCorrectionDetailPage({ params }: { params: Promise<{ requestId: string }> }) {
  const profile = await requireRole("super_admin");
  const { requestId } = await params;
  if (!UUID.test(requestId)) notFound();
  const { data: r, error } = await getRequest(requestId);
  const back = <Link href="/admin/certificates/identity-correction" className="ta-btn ta-btn-outline">Back to corrections</Link>;
  if (error || !r) return <div><PageHead title="Identity correction" secondaryAction={back} /><ReadErrorState message={identityCorrectionMessage(error)} /></div>;

  const isPending = r.status === "pending";
  const selfRequested = r.requested_by === profile.id;
  // The database enforces the real rule (IDC_SELF_APPROVAL); this only avoids offering a button that cannot work.
  const canApprove = isPending && r.requires_second_approval && !r.second_approver && !selfRequested;

  return (
    <div>
      <PageHead
        title="Identity correction"
        subtitle={`Participant ${r.participant_code ?? "—"} · ${KIND[r.change_kind] ?? r.change_kind}`}
        secondaryAction={back}
        action={<Badge status={PILL[r.status]} label={r.status[0].toUpperCase() + r.status.slice(1)} />}
      />

      {r.stale && isPending && (
        <div role="alert" className="ta-alert ta-alert-error">The participant or one of their certificates changed after this request was made. It cannot be applied — cancel it and start a new request.</div>
      )}

      <Card title="Request">
        <dl className="ta-dl">
          <dt>Requested</dt><dd>{fmt(r.requested_at)}</dd>
          <dt>Earliest it can be applied</dt><dd>{fmt(r.earliest_apply_at)}{isPending && !r.waiting_elapsed ? " (waiting period running)" : ""}</dd>
          {r.new_full_name && (<><dt>New name</dt><dd>{r.new_full_name}</dd></>)}
          {r.new_identity_masked && (<><dt>New IC / Passport</dt><dd>{r.new_identity_masked}</dd></>)}
          <dt>Participant profile</dt><dd>{r.apply_to_profile ? "Updated too" : "Not changed"}</dd>
          <dt>Reason</dt><dd>{r.reason}</dd>
          {r.requires_second_approval && (<><dt>Second approval</dt><dd>{r.second_approver ? `Given ${fmt(r.second_approved_at)}` : "Not yet given"}</dd></>)}
          {r.applied_at && (<><dt>Applied</dt><dd>{fmt(r.applied_at)}</dd></>)}
          {r.closed_at && (<><dt>Closed</dt><dd>{fmt(r.closed_at)} — {r.closure_reason}</dd></>)}
        </dl>
      </Card>

      <Card title="Certificates and decisions">
        <div className="ta-table-wrap">
          <table className="ta-table">
            <thead><tr><th>Certificate</th><th>Kind</th><th>Name</th><th>IC / Passport</th><th>Reason</th></tr></thead>
            <tbody>
              {r.certificates.map((c) => (
                <tr key={c.certificate_id}>
                  <td><Link href={`/admin/certificates/${c.certificate_id}`}>{c.certificate_number}</Link></td>
                  <td>{c.identity_class === "none" ? "—" : `Class ${c.identity_class}`}</td>
                  <td>{c.name_decision ? DECISION[c.name_decision] ?? c.name_decision : "—"}</td>
                  <td>{c.identity_decision ? DECISION[c.identity_decision] ?? c.identity_decision : "—"}</td>
                  <td>{c.decision_reason ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Evidence reviewed">
        <div className="ta-table-wrap">
          <table className="ta-table">
            <thead><tr><th>Type</th><th>Reference</th><th>Reviewed on</th><th>Fingerprint</th></tr></thead>
            <tbody>
              {r.evidence.map((e, i) => (
                <tr key={i}><td>{e.type.replace(/_/g, " ")}</td><td>{e.reference}</td><td>{e.reviewed_on}</td><td><code>{e.sha256_prefix}…</code></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {isPending && <RequestActions requestId={r.id} canApply={r.can_apply} canApprove={canApprove} />}
    </div>
  );
}
