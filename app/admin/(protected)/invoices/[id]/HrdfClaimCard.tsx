import { Card, Badge } from "../../../../../components/admin/ui";
import { HRDF_CLAIM_STATUS_LABELS } from "../../../../../lib/sales/hrdf-claims";
import type { HrdfClaim } from "../../../../../lib/supabase/database.types";

function money(value: number | null) { return value === null ? "—" : `RM ${Number(value).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`; }

// Read-only (S1, Owner 2026-11-22): HRD Corp grants and claims are managed in the official HRD Corp portal, so this
// card renders no claim, transition or HRDF-payment control. Receipts from HRD Corp are recorded with the invoice's
// ordinary Record Payment form. An existing legacy claim is still shown so its history stays visible.
export function HrdfClaimCard({ applicable, claim }: { applicable: boolean; claim: HrdfClaim | null }) {
  if (!applicable && !claim) return null;
  const notice = <p style={{ margin: 0, color: "var(--ta-muted)", fontSize: 13 }}>HRD Corp grants and claims are managed in the HRD Corp portal. Record money received from HRD Corp with Record Payment (payment detail “HRD Corp”, the HRD Corp payment reference, and the grant/claim reference in the notes).</p>;
  if (!claim) return <Card title="HRDF"><div className="ta-card-pad">{notice}</div></Card>;

  return <Card title="HRDF Claim (legacy record, read-only)">
    <div className="ta-card-pad" style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}><Badge status={HRDF_CLAIM_STATUS_LABELS[claim.status]} /><span style={{ color: "var(--ta-muted)", fontSize: 12 }}>Invoice {claim.invoice_number_snapshot}</span></div>
      <dl style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 5, margin: 0 }}>
        <dt>Grant reference</dt><dd style={{ margin: 0 }}>{claim.grant_reference ?? "—"}</dd>
        <dt>Grant amount</dt><dd style={{ margin: 0 }}>{money(claim.grant_amount)}</dd>
        <dt>Claim reference</dt><dd style={{ margin: 0 }}>{claim.claim_reference ?? "—"}</dd>
        <dt>Claim amount</dt><dd style={{ margin: 0 }}>{money(claim.claim_amount)}</dd>
        <dt>Approved amount</dt><dd style={{ margin: 0 }}>{money(claim.approved_amount)}</dd>
        <dt>HRDF received</dt><dd style={{ margin: 0 }}>{money(claim.payment_received_amount)}</dd>
      </dl>
      {notice}
    </div>
  </Card>;
}
