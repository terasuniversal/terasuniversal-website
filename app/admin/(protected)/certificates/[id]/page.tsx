import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { requireModuleAccess, requireCertificate } from "../../../../../lib/auth/session";
import { canManageCertificate } from "../../../../../lib/auth/rbac";
import { PageHead, Card, Badge, Field } from "../../../../../components/admin/ui";
import { CertificateFront, CertificateBack } from "../../../../../components/admin/CertificateRenderer";
import { loadCertificateRender } from "../certData";
import { revokeCertificate, reissueCertificate, duplicateCertificate, updateCertificateMeta, softDeleteCertificate, regenerateVerificationToken, setVerificationEnabled } from "../actions";
import { EmptyState } from "../../../../../components/admin/ui";
import { formatMalaysiaDateTime } from "../../../../../lib/date-time";

interface ReissueHistoryRow {
  id: string;
  event_type: string;
  reason: string | null;
  reissued_at: string;
  reissued_by: string;
}

export const metadata = { title: "Certificate — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

export default async function CertificateDetailPage({ params }: { params: Promise<{ id: string }> }) {
await requireModuleAccess("certificates");
  const profile = await requireCertificate(false);
  const canManage = canManageCertificate(profile.role);
  const { id } = await params;
  const r = await loadCertificateRender(id);
  if (!r) notFound();
  const cert = r.cert;

  // Verification history (audit of public verification attempts).
  const supabase = await createSupabaseServerClient();
  const { data: history } = await supabase
    .from("certificate_verifications")
    .select("method, status_returned, ip_address, verified_at")
    .eq("certificate_id", id)
    .order("verified_at", { ascending: false })
    .limit(15);
  const { data: reissueHistory, error: reissueHistoryError } = await supabase
    .from("certificate_reissue_events")
    .select("id, event_type, reason, reissued_at, reissued_by")
    .eq("certificate_id", id)
    .order("reissued_at", { ascending: false })
    .limit(20);
  if (reissueHistoryError) throw new Error("Unable to load certificate reissue history.");

  return (
    <>
      <PageHead
        title={cert.holder_name}
        subtitle={cert.certificate_number}
        action={
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link href="/admin/certificates" className="ta-btn ta-btn-outline">← Back</Link>
            <a href={`/admin/cert-pdf/${id}`} target="_blank" rel="noreferrer" className="ta-btn ta-btn-primary">⬇ Download PDF</a>
          </div>
        }
      />

      <div style={{ marginBottom: 16, display: "flex", gap: 10, alignItems: "center" }}>
        <Badge status={cert.status} />
        {r.data.render_mode && <span style={{ fontSize: 12, color: "var(--ta-muted)" }}>{r.data.render_mode}{r.data.renderer_version ? ` · ${r.data.renderer_version}` : ""}</span>}
        {r.data.verification_url && <a href={r.data.verification_url} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: "var(--ta-info)" }}>Public verification link ↗</a>}
      </div>

      <div className="ta-grid cols-2" style={{ alignItems: "start" }}>
        {/* Preview — front + back, A4 portrait */}
        <Card title="Preview">
          <div className="ta-card-pad" style={{ background: "#eef1f6", overflow: "hidden", display: "grid", gap: 12 }}>
            <div style={{ overflow: "hidden", height: 500 }}>
              <div style={{ transform: "scale(0.44)", transformOrigin: "top left" }}>
                <CertificateFront data={r.data} config={r.config} />
              </div>
            </div>
            <div style={{ overflow: "hidden", height: 500 }}>
              <div style={{ transform: "scale(0.44)", transformOrigin: "top left" }}>
                <CertificateBack data={r.data} config={r.config} />
              </div>
            </div>
          </div>
        </Card>

        <div style={{ display: "grid", gap: 18 }}>
          <Card title="Details">
            <div className="ta-card-pad">
              <dl style={{ display: "grid", gridTemplateColumns: "150px 1fr", gap: 6, margin: 0 }}>
                <dt style={{ color: "var(--ta-muted)" }}>Certificate No.</dt><dd style={{ margin: 0, fontFamily: "monospace" }}>{cert.certificate_number}</dd>
                <dt style={{ color: "var(--ta-muted)" }}>Course</dt><dd style={{ margin: 0 }}>{r.data.course_name ?? "—"}</dd>
                <dt style={{ color: "var(--ta-muted)" }}>Issued</dt><dd style={{ margin: 0 }}>{r.data.issue_date ?? "—"}</dd>
                <dt style={{ color: "var(--ta-muted)" }}>Verification link</dt><dd style={{ margin: 0, fontFamily: "monospace", fontSize: 12, wordBreak: "break-all" }}>{r.data.verification_url ?? "—"}</dd>
              </dl>
            </div>
          </Card>

          {canManage && (
            <>
              <Card title="Actions">
                <div className="ta-card-pad" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {cert.status !== "revoked" && <form action={revokeCertificate.bind(null, id)}><button className="ta-btn ta-btn-danger">Revoke</button></form>}
                  <form action={reissueCertificate.bind(null, id)} style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
                    <label style={{ fontSize: 12 }}>Event
                      <select name="event_type" defaultValue="reissue" style={{ display: "block", marginTop: 4 }}>
                        <option value="reissue">Reissue</option>
                        <option value="reprint">Reprint</option>
                      </select>
                    </label>
                    <label style={{ fontSize: 12 }}>Reason
                      <input name="reason" required maxLength={500} style={{ display: "block", marginTop: 4 }} />
                    </label>
                    <button className="ta-btn ta-btn-gold">Record event</button>
                  </form>
                  <form action={duplicateCertificate.bind(null, id)}><button className="ta-btn ta-btn-outline">Duplicate</button></form>
                  <button className="ta-btn ta-btn-outline" disabled title="Email delivery — coming soon">✉ Email (soon)</button>
                  <form action={softDeleteCertificate.bind(null, id)}><button className="ta-btn ta-btn-outline">Delete</button></form>
                </div>
              </Card>

              <Card title="Reissue History">
                <div className="ta-card-pad">
                  {reissueHistory && reissueHistory.length > 0 ? (
                    <div className="ta-table-wrap"><table className="ta-table">
                      <thead><tr><th>When</th><th>Type</th><th>Reason</th><th>Actor</th></tr></thead>
                      <tbody>{(reissueHistory as ReissueHistoryRow[]).map((event) => (
                        <tr key={event.id}>
                          <td style={{ whiteSpace: "nowrap" }}>{formatMalaysiaDateTime(event.reissued_at)}</td>
                          <td>{event.event_type}</td>
                          <td>{event.reason ?? "—"}</td>
                          <td style={{ fontFamily: "monospace", fontSize: 11 }}>{event.reissued_by ?? "—"}</td>
                        </tr>
                      ))}</tbody>
                    </table></div>
                  ) : <EmptyState icon="↻" message="No reissue or reprint events recorded." />}
                </div>
              </Card>

              <Card title="Verification">
                <div className="ta-card-pad" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ fontSize: 13 }}>
                    Public verification: <strong style={{ color: cert.verification_enabled === false ? "var(--ta-danger)" : "var(--ta-success)" }}>{cert.verification_enabled === false ? "Disabled" : "Enabled"}</strong>
                  </span>
                  <div style={{ flex: 1 }} />
                  <form action={setVerificationEnabled.bind(null, id, cert.verification_enabled === false)}>
                    <button className="ta-btn ta-btn-outline ta-btn-sm">{cert.verification_enabled === false ? "Enable" : "Disable"}</button>
                  </form>
                  <form action={regenerateVerificationToken.bind(null, id)}>
                    <button className="ta-btn ta-btn-outline ta-btn-sm" title="Invalidates the current QR / link">↻ Regenerate token</button>
                  </form>
                </div>
              </Card>

              <Card title="Edit">
                <div className="ta-card-pad">
                  <form action={updateCertificateMeta.bind(null, id)} className="ta-form">
                    <Field label="Expiry date (optional)" name="expiry_date">
                      <input id="expiry_date" name="expiry_date" type="date" defaultValue={cert.expiry_date ?? ""} />
                    </Field>
                    <Field label="Remarks" name="remarks">
                      <textarea id="remarks" name="remarks" rows={2} defaultValue={cert.remarks ?? ""} />
                    </Field>
                    <div className="ta-form-actions"><button className="ta-btn ta-btn-primary" type="submit">Save</button></div>
                  </form>
                </div>
              </Card>
            </>
          )}
        </div>
      </div>

      {/* Verification history (all staff) */}
      <Card title="Verification History" >
        {history && history.length > 0 ? (
          <div className="ta-table-wrap">
            <table className="ta-table">
              <thead><tr><th>When</th><th>Method</th><th>Result</th><th>IP</th></tr></thead>
              <tbody>
                {history.map((h: any, i: number) => (
                  <tr key={i}>
                    <td style={{ whiteSpace: "nowrap" }}>{formatMalaysiaDateTime(h.verified_at)}</td>
                    <td style={{ textTransform: "capitalize" }}>{h.method}</td>
                    <td><Badge status={h.status_returned === "valid" ? "issued" : h.status_returned} /></td>
                    <td style={{ color: "var(--ta-muted)" }}>{h.ip_address ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon="🔎" message="No verification attempts recorded yet." />
        )}
      </Card>
    </>
  );
}
