"use client";

import { useActionState, useState } from "react";
import { Card, Field, Badge } from "../../../../../components/admin/ui";
import { issueInvoiceAction, recordManualPaymentAction, cancelInvoiceAction, type InvoiceActionState } from "../actions";
import { generateToyyibpayPaymentLinkAction, refreshToyyibpayStatusAction, type ToyyibpayLinkState, type ToyyibpayRefreshState } from "../toyyibpayActions";
import { MANUAL_PAYMENT_PROVIDERS, PAYMENT_PROVIDER_LABELS, type InvoiceStatus, type InvoicePaymentRow } from "../../../../../lib/sales/invoices";

const INITIAL: InvoiceActionState = {};
const TOYYIBPAY_INITIAL: ToyyibpayLinkState = {};
const REFRESH_INITIAL: ToyyibpayRefreshState = {};

function fmtRM(n: number) {
  return `RM ${Number(n).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;
}
function fmtDateTime(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-MY", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function InvoiceActionsPanel({
  invoiceId,
  invoiceNo,
  status,
  balanceDue,
  amountPaid,
  canManage,
  toyyibpayEnabled,
  toyyibpayIsSandbox,
  latestToyyibpayAttempt,
}: {
  invoiceId: string;
  invoiceNo: string;
  status: InvoiceStatus;
  balanceDue: number;
  amountPaid: number;
  canManage: boolean;
  /** Server-derived capability flag (TOYYIBPAY_ENV is "sandbox" or "production") -- never a raw env var or secret, just this one boolean. A deployment with TOYYIBPAY_ENV unset/invalid renders no ToyyibPay card at all. */
  toyyibpayEnabled: boolean;
  /** Server-derived, from the same capability check -- true only when TOYYIBPAY_ENV === "sandbox". Controls the SANDBOX/TEST PAYMENT badge and copy only; never the actual request routing (that's lib/payments/toyyibpay.ts's own resolver). */
  toyyibpayIsSandbox: boolean;
  /** Most recent invoice_payments row for payment_provider='toyyibpay', or null -- persisted server state, so the card reflects reality on first load, not just right after a Generate click. */
  latestToyyibpayAttempt: InvoicePaymentRow | null;
}) {
  const [issueState, issueAction, issuePending] = useActionState(issueInvoiceAction.bind(null, invoiceId), INITIAL);
  const [paymentState, paymentAction, paymentPending] = useActionState(recordManualPaymentAction.bind(null, invoiceId), INITIAL);
  const [cancelState, cancelAction, cancelPending] = useActionState(cancelInvoiceAction.bind(null, invoiceId), INITIAL);
  const [toyyibpayState, toyyibpayAction, toyyibpayPending] = useActionState(
    generateToyyibpayPaymentLinkAction.bind(null, invoiceId),
    TOYYIBPAY_INITIAL
  );
  const [refreshState, refreshAction, refreshPending] = useActionState(
    refreshToyyibpayStatusAction.bind(null, latestToyyibpayAttempt?.id ?? ""),
    REFRESH_INITIAL
  );
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedWhatsapp, setCopiedWhatsapp] = useState(false);

  function copyToClipboard(text: string, setCopied: (v: boolean) => void) {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!canManage) {
    return (
      <Card title="Manage Invoice">
        <div className="ta-card-pad" style={{ color: "var(--ta-muted)", fontSize: 13 }}>
          Issuing, recording payments, and cancelling require Admin access. You can view this invoice's status and payment history.
        </div>
      </Card>
    );
  }

  const hasActiveToyyibpayAttempt = latestToyyibpayAttempt?.status === "pending";
  const attempt = latestToyyibpayAttempt;

  return (
    <>
      {status === "draft" && (
        <Card title="Issue">
          <form action={issueAction} className="ta-card-pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {issueState.message && <div className="ta-alert ta-alert-error">{issueState.message}</div>}
            <p style={{ margin: 0, fontSize: 13, color: "var(--ta-muted)" }}>
              Freezes this invoice's items and totals and makes it payable. Edit the billing details and due date before issuing — they cannot be changed afterward.
            </p>
            <button
              type="submit"
              className="ta-btn ta-btn-primary ta-btn-sm"
              disabled={issuePending}
              onClick={(e) => { if (!confirm("Issue this invoice? Commercial fields and items will be frozen.")) e.preventDefault(); }}
            >
              {issuePending ? "Issuing…" : "📤 Issue Invoice"}
            </button>
          </form>
        </Card>
      )}

      {(status === "issued" || status === "partially_paid") && (
        <Card title="Record Manual Payment">
          <div className="ta-card-pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {hasActiveToyyibpayAttempt && (
              <div className="ta-alert ta-alert-info">
                A ToyyibPay payment link is currently active for this invoice. Resolve or deactivate that attempt before recording a manual payment.
              </div>
            )}
            <form action={paymentAction} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {paymentState.message && <div className="ta-alert ta-alert-error">{paymentState.message}</div>}
              <p style={{ margin: 0, fontSize: 13, color: "var(--ta-muted)" }}>
                Outstanding balance: <strong>{fmtRM(balanceDue)}</strong>
                {amountPaid > 0 && <> ({fmtRM(amountPaid)} already paid)</>}
              </p>
              <Field label="Payment method" name="payment_provider" error={paymentState.errors?.payment_provider} required>
                <select name="payment_provider" defaultValue="bank_transfer" required>
                  {MANUAL_PAYMENT_PROVIDERS.map((p) => <option key={p} value={p}>{PAYMENT_PROVIDER_LABELS[p]}</option>)}
                </select>
              </Field>
              <Field label="Bank / reference detail" name="payment_method" error={paymentState.errors?.payment_method} hint="e.g. bank name, cheque no.">
                <input type="text" name="payment_method" maxLength={100} />
              </Field>
              <Field label="Amount (RM)" name="amount" error={paymentState.errors?.amount} required>
                <input type="number" name="amount" step="0.01" min="0.01" max={balanceDue} required />
              </Field>
              <Field label="Payment date" name="payment_date" error={paymentState.errors?.payment_date} required>
                <input type="date" name="payment_date" defaultValue={new Date().toISOString().slice(0, 10)} required />
              </Field>
              <Field label="Payment reference" name="payment_reference" error={paymentState.errors?.payment_reference} hint="Transaction/reference number, if any">
                <input type="text" name="payment_reference" maxLength={200} />
              </Field>
              <Field label="Notes" name="notes" error={paymentState.errors?.notes}>
                <textarea name="notes" rows={2} maxLength={1000} />
              </Field>
              <button type="submit" className="ta-btn ta-btn-primary ta-btn-sm" disabled={paymentPending} style={{ alignSelf: "flex-start" }}>
                {paymentPending ? "Recording…" : "Record Payment"}
              </button>
            </form>
          </div>
        </Card>
      )}

      {(status === "issued" || status === "partially_paid") && toyyibpayEnabled && (
        <Card title="ToyyibPay Payment Link">
          <div className="ta-card-pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {toyyibpayIsSandbox && (
              <span
                style={{
                  alignSelf: "flex-start",
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: 0.5,
                  color: "#92400e",
                  background: "#fef3c7",
                  border: "1px solid #fde68a",
                  borderRadius: 4,
                  padding: "2px 6px",
                }}
              >
                SANDBOX / TEST PAYMENT
              </span>
            )}
            {toyyibpayState.message && <div className="ta-alert ta-alert-error">{toyyibpayState.message}</div>}
            {refreshState.message && <div className="ta-alert ta-alert-error">{refreshState.message}</div>}

            {/* State A -- no attempt at all yet */}
            {!attempt && (
              <>
                <p style={{ margin: 0, fontSize: 13, color: "var(--ta-muted)" }}>
                  {toyyibpayIsSandbox
                    ? "Creates a secure payment link for the current outstanding balance. This is a test payment link only — it does not connect to any real bank account and no real money moves."
                    : "Creates a secure payment link for the current outstanding balance. This is a real ToyyibPay payment link — completing it moves real money."}
                </p>
                <p style={{ margin: 0, fontSize: 13 }}>
                  Balance due: <strong>{fmtRM(balanceDue)}</strong>
                </p>
                <form action={toyyibpayAction}>
                  <button type="submit" className="ta-btn ta-btn-primary ta-btn-sm" disabled={toyyibpayPending}>
                    {toyyibpayPending ? "Generating…" : "🧪 Generate ToyyibPay Payment Link"}
                  </button>
                </form>
              </>
            )}

            {/* State B -- pending attempt */}
            {attempt?.status === "pending" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <strong>Payment Pending</strong>
                  <Badge status={attempt.status} />
                </div>
                <div>
                  BillCode: <code style={{ wordBreak: "break-all" }}>{attempt.provider_bill_code}</code>
                </div>
                <div>
                  Amount requested: <strong>{fmtRM(attempt.amount)}</strong>
                </div>
                <div style={{ color: "var(--ta-muted)" }}>Requested {fmtDateTime(attempt.created_at)}</div>
                {attempt.payment_url && (
                  <div style={{ wordBreak: "break-all", fontSize: 12, color: "var(--ta-muted)" }}>{attempt.payment_url}</div>
                )}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {attempt.payment_url && (
                    <>
                      <button
                        type="button"
                        className="ta-btn ta-btn-outline ta-btn-sm"
                        onClick={() => copyToClipboard(attempt.payment_url!, setCopiedLink)}
                      >
                        {copiedLink ? "Copied" : "Copy Payment Link"}
                      </button>
                      <a href={attempt.payment_url} target="_blank" rel="noreferrer" className="ta-btn ta-btn-outline ta-btn-sm">
                        Open Payment Page ↗
                      </a>
                      <button
                        type="button"
                        className="ta-btn ta-btn-outline ta-btn-sm"
                        onClick={() =>
                          copyToClipboard(
                            `Assalamualaikum / Hi,\nPlease use the secure ToyyibPay payment link below for Invoice ${invoiceNo}.\n\nAmount Due: ${fmtRM(attempt.amount)}\nPayment Link: ${attempt.payment_url}\n\nTERAS UNIVERSAL SDN. BHD.`,
                            setCopiedWhatsapp
                          )
                        }
                      >
                        {copiedWhatsapp ? "Copied" : "Copy WhatsApp Message"}
                      </button>
                    </>
                  )}
                </div>
                <form action={refreshAction}>
                  <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm" disabled={refreshPending} style={{ alignSelf: "flex-start" }}>
                    {refreshPending ? "Checking…" : "Refresh / Re-check Status"}
                  </button>
                </form>
              </div>
            )}

            {/* State C -- successful */}
            {attempt?.status === "successful" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <strong>Payment Successful</strong>
                  <Badge status={attempt.status} />
                </div>
                {(attempt.provider_transaction_id ?? attempt.provider_bill_code) && (
                  <div>Reference: <code style={{ wordBreak: "break-all" }}>{attempt.provider_transaction_id ?? attempt.provider_bill_code}</code></div>
                )}
                {attempt.verified_amount !== null && <div>Verified amount: <strong>{fmtRM(attempt.verified_amount)}</strong></div>}
                <div style={{ color: "var(--ta-muted)" }}>Paid {fmtDateTime(attempt.paid_at)}</div>
              </div>
            )}

            {/* State D -- failed (also covers cancelled/refunded as a generic terminal-but-not-active fallback) */}
            {attempt && (attempt.status === "failed" || attempt.status === "cancelled" || attempt.status === "refunded") && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <strong>Previous Payment Attempt Failed</strong>
                  <Badge status={attempt.status} />
                </div>
                {attempt.provider_bill_code && <div>BillCode: <code style={{ wordBreak: "break-all" }}>{attempt.provider_bill_code}</code></div>}
                {balanceDue > 0 && (
                  <form action={toyyibpayAction}>
                    <button type="submit" className="ta-btn ta-btn-primary ta-btn-sm" disabled={toyyibpayPending}>
                      {toyyibpayPending ? "Generating…" : "Generate New Payment Link"}
                    </button>
                  </form>
                )}
              </div>
            )}

            {/* State E -- superseded */}
            {attempt?.status === "superseded" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <strong>Payment Link Superseded</strong>
                  <Badge status={attempt.status} />
                </div>
                <p style={{ margin: 0, color: "var(--ta-muted)" }}>
                  This payment link is no longer the active TERAS payment attempt for this invoice.
                </p>
                {balanceDue > 0 && (
                  <form action={toyyibpayAction}>
                    <button type="submit" className="ta-btn ta-btn-primary ta-btn-sm" disabled={toyyibpayPending}>
                      {toyyibpayPending ? "Generating…" : "Generate New Payment Link"}
                    </button>
                  </form>
                )}
              </div>
            )}
          </div>
        </Card>
      )}

      {(status === "draft" || (status === "issued" && amountPaid === 0)) && (
        <Card title="Cancel">
          <form action={cancelAction} className="ta-card-pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {cancelState.message && <div className="ta-alert ta-alert-error">{cancelState.message}</div>}
            <Field label="Reason (optional)" name="reason" error={cancelState.errors?.reason}>
              <textarea name="reason" rows={2} maxLength={500} />
            </Field>
            <button
              type="submit"
              className="ta-btn ta-btn-outline ta-btn-sm"
              disabled={cancelPending}
              onClick={(e) => { if (!confirm("Cancel this invoice? This cannot be undone.")) e.preventDefault(); }}
            >
              {cancelPending ? "Cancelling…" : "Cancel Invoice"}
            </button>
          </form>
        </Card>
      )}

      {status === "paid" && (
        <Card title="Status">
          <div className="ta-card-pad" style={{ color: "var(--ta-muted)", fontSize: 13 }}>This invoice is fully paid — no further changes possible.</div>
        </Card>
      )}
      {status === "cancelled" && (
        <Card title="Status">
          <div className="ta-card-pad" style={{ color: "var(--ta-muted)", fontSize: 13 }}>This invoice was cancelled.</div>
        </Card>
      )}
      {status === "issued" && amountPaid > 0 && (
        <Card title="Cancellation">
          <div className="ta-card-pad" style={{ color: "var(--ta-muted)", fontSize: 13 }}>This invoice has received a payment and can no longer be cancelled directly.</div>
        </Card>
      )}
    </>
  );
}
