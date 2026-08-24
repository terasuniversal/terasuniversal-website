"use client";

import { useActionState, useState } from "react";
import { Card, Field } from "../../../../../components/admin/ui";
import { issueInvoiceAction, recordManualPaymentAction, cancelInvoiceAction, type InvoiceActionState } from "../actions";
import { generateToyyibpayPaymentLinkAction, type ToyyibpayLinkState } from "../toyyibpayActions";
import { MANUAL_PAYMENT_PROVIDERS, PAYMENT_PROVIDER_LABELS, type InvoiceStatus } from "../../../../../lib/sales/invoices";

const INITIAL: InvoiceActionState = {};
const TOYYIBPAY_INITIAL: ToyyibpayLinkState = {};

export function InvoiceActionsPanel({
  invoiceId,
  status,
  balanceDue,
  amountPaid,
  canManage,
  toyyibpayEnabled,
}: {
  invoiceId: string;
  status: InvoiceStatus;
  balanceDue: number;
  amountPaid: number;
  canManage: boolean;
  /** Server-derived capability flag (TOYYIBPAY_ENV === "sandbox") -- never a raw env var or secret, just this one boolean. Production (or any non-sandbox deployment) renders no ToyyibPay card at all. */
  toyyibpayEnabled: boolean;
}) {
  const [issueState, issueAction, issuePending] = useActionState(issueInvoiceAction.bind(null, invoiceId), INITIAL);
  const [paymentState, paymentAction, paymentPending] = useActionState(recordManualPaymentAction.bind(null, invoiceId), INITIAL);
  const [cancelState, cancelAction, cancelPending] = useActionState(cancelInvoiceAction.bind(null, invoiceId), INITIAL);
  const [toyyibpayState, toyyibpayAction, toyyibpayPending] = useActionState(
    generateToyyibpayPaymentLinkAction.bind(null, invoiceId),
    TOYYIBPAY_INITIAL
  );
  const [copied, setCopied] = useState(false);

  if (!canManage) {
    return (
      <Card title="Manage Invoice">
        <div className="ta-card-pad" style={{ color: "var(--ta-muted)", fontSize: 13 }}>
          Issuing, recording payments, and cancelling require Admin access. You can view this invoice's status and payment history.
        </div>
      </Card>
    );
  }

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
          <form action={paymentAction} className="ta-card-pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {paymentState.message && <div className="ta-alert ta-alert-error">{paymentState.message}</div>}
            <p style={{ margin: 0, fontSize: 13, color: "var(--ta-muted)" }}>
              Outstanding balance: <strong>RM {balanceDue.toLocaleString("en-MY", { minimumFractionDigits: 2 })}</strong>
              {amountPaid > 0 && <> (RM {amountPaid.toLocaleString("en-MY", { minimumFractionDigits: 2 })} already paid)</>}
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
            <button type="submit" className="ta-btn ta-btn-primary ta-btn-sm" disabled={paymentPending}>
              {paymentPending ? "Recording…" : "Record Payment"}
            </button>
          </form>
        </Card>
      )}

      {(status === "issued" || status === "partially_paid") && toyyibpayEnabled && (
        <Card title="ToyyibPay Payment Link">
          <form action={toyyibpayAction} className="ta-card-pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
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
            {toyyibpayState.message && <div className="ta-alert ta-alert-error">{toyyibpayState.message}</div>}
            <p style={{ margin: 0, fontSize: 13, color: "var(--ta-muted)" }}>
              Generates a ToyyibPay <strong>sandbox</strong> bill for the full outstanding balance. This is a test payment
              link only — it does not connect to any real bank account and no real money moves. Creating or opening this
              link does not mark the invoice paid; that only happens once a verified payment is confirmed (a later phase).
            </p>
            {!toyyibpayState.billcode ? (
              <button type="submit" className="ta-btn ta-btn-primary ta-btn-sm" disabled={toyyibpayPending}>
                {toyyibpayPending ? "Generating…" : "🧪 Generate ToyyibPay Payment Link"}
              </button>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
                {toyyibpayState.reused && (
                  <div style={{ color: "var(--ta-muted)" }}>An existing pending attempt was reused — no new bill was created.</div>
                )}
                <div>
                  BillCode: <code>{toyyibpayState.billcode}</code>
                </div>
                <div>
                  Amount:{" "}
                  <strong>
                    RM {Number(toyyibpayState.amount ?? 0).toLocaleString("en-MY", { minimumFractionDigits: 2 })}
                  </strong>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="ta-btn ta-btn-outline ta-btn-sm"
                    onClick={() => {
                      if (toyyibpayState.paymentUrl) {
                        navigator.clipboard.writeText(toyyibpayState.paymentUrl);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      }
                    }}
                  >
                    {copied ? "Copied!" : "Copy Payment Link"}
                  </button>
                  {toyyibpayState.paymentUrl && (
                    <a href={toyyibpayState.paymentUrl} target="_blank" rel="noreferrer" className="ta-btn ta-btn-outline ta-btn-sm">
                      Open Sandbox Payment Page ↗
                    </a>
                  )}
                </div>
                <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm" disabled={toyyibpayPending} style={{ alignSelf: "flex-start" }}>
                  {toyyibpayPending ? "Checking…" : "Regenerate / Refresh Link"}
                </button>
              </div>
            )}
          </form>
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
