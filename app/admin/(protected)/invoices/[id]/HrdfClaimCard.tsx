import { Card, Badge } from "../../../../../components/admin/ui";
import { HRDF_CLAIM_STATUS_LABELS } from "../../../../../lib/sales/hrdf-claims";
import type { HrdfClaim } from "../../../../../lib/supabase/database.types";
import { createHrdfClaimAction, recordHrdfPaymentAction, transitionHrdfClaimAction } from "./actions";

function money(value: number | null) { return value === null ? "—" : `RM ${Number(value).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`; }

export function HrdfClaimCard({ invoiceId, applicable, claim, canManage }: { invoiceId: string; applicable: boolean; claim: HrdfClaim | null; canManage: boolean }) {
  if (!applicable) return <Card title="HRDF Claim"><div className="ta-card-pad">Not Applicable — this invoice has no HRDF-claimable item.</div></Card>;
  if (!claim) return <Card title="HRDF Claim"><div className="ta-card-pad"><p style={{ marginTop: 0 }}>This invoice is eligible for HRDF claim tracking.</p>{canManage && <form action={createHrdfClaimAction.bind(null, invoiceId)}><button className="ta-btn ta-btn-primary" type="submit">Start HRDF Claim</button></form>}</div></Card>;

  const transition = transitionHrdfClaimAction.bind(null, claim.id, invoiceId);
  return <Card title="HRDF Claim">
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
      {canManage && <>
        {claim.status === "grant_pending" && <div style={{ display: "grid", gap: 8 }}><form action={transition}><input type="hidden" name="to_status" value="grant_approved" /><input name="grant_reference" required placeholder="Grant reference" className="ta-input" /><input name="grant_approved_date" required type="date" className="ta-input" /><input name="grant_amount" required type="number" step="0.01" min="0" placeholder="Grant amount" className="ta-input" /><button className="ta-btn ta-btn-primary" type="submit">Approve Grant</button></form><form action={transition}><input type="hidden" name="to_status" value="grant_rejected" /><input name="rejection_reason" required placeholder="Rejection reason" className="ta-input" /><button className="ta-btn ta-btn-outline" type="submit">Reject Grant</button></form></div>}
        {claim.status === "grant_approved" && <form action={transition}><input type="hidden" name="to_status" value="training_in_progress" /><button className="ta-btn ta-btn-primary" type="submit">Start Training</button></form>}
        {claim.status === "training_in_progress" && <form action={transition}><input type="hidden" name="to_status" value="training_completed" /><button className="ta-btn ta-btn-primary" type="submit">Mark Training Completed</button></form>}
        {claim.status === "training_completed" && <form action={transition}><input type="hidden" name="to_status" value="claim_ready" /><button className="ta-btn ta-btn-primary" type="submit">Mark Claim Ready</button></form>}
        {claim.status === "claim_ready" && <form action={transition} style={{ display: "grid", gap: 8 }}><input type="hidden" name="to_status" value="claim_submitted" /><input name="claim_reference" required placeholder="Claim reference" className="ta-input" /><input name="claim_submitted_date" required type="date" className="ta-input" /><input name="claim_amount" required type="number" step="0.01" min="0" placeholder="Claim amount" className="ta-input" /><button className="ta-btn ta-btn-primary" type="submit">Submit Claim</button></form>}
        {claim.status === "claim_submitted" && <div style={{ display: "grid", gap: 8 }}><form action={transition}><input type="hidden" name="to_status" value="claim_approved" /><input name="claim_approved_date" required type="date" className="ta-input" /><input name="approved_amount" required type="number" step="0.01" min="0" placeholder="Approved amount" className="ta-input" /><button className="ta-btn ta-btn-primary" type="submit">Approve Claim</button></form><form action={transition}><input type="hidden" name="to_status" value="claim_rejected" /><input name="rejection_reason" required placeholder="Rejection reason" className="ta-input" /><button className="ta-btn ta-btn-outline" type="submit">Reject Claim</button></form></div>}
        {claim.status === "claim_rejected" && <form action={transition}><input type="hidden" name="to_status" value="claim_ready" /><button className="ta-btn ta-btn-outline" type="submit">Prepare Resubmission</button></form>}
        {claim.status === "claim_approved" && <form action={recordHrdfPaymentAction.bind(null, claim.id, invoiceId)} style={{ display: "grid", gap: 8 }}><input name="amount" required type="number" step="0.01" min="0" placeholder="Payment amount" className="ta-input" /><select name="payment_provider" className="ta-input" defaultValue="bank_transfer"><option value="bank_transfer">Bank Transfer</option><option value="cash">Cash</option><option value="cheque">Cheque</option><option value="other">Other</option></select><input name="payment_date" type="date" className="ta-input" /><input name="payment_reference" required placeholder="Payment reference" className="ta-input" /><button className="ta-btn ta-btn-primary" type="submit">Record HRDF Payment</button></form>}
        {claim.status === "payment_received" && <p style={{ margin: 0, color: "var(--ta-muted)" }}>Payment evidence recorded. Further receipts remain subject to approved amount and invoice balance.</p>}
      </>}
    </div>
  </Card>;
}
