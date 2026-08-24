"use client";

import { useActionState } from "react";
import { Card, Field } from "../../../../../components/admin/ui";
import { issueInvoiceAction, recordManualPaymentAction, cancelInvoiceAction, type InvoiceActionState } from "../actions";
import { MANUAL_PAYMENT_PROVIDERS, PAYMENT_PROVIDER_LABELS, type InvoiceStatus } from "../../../../../lib/sales/invoices";

const INITIAL: InvoiceActionState = {};

export function InvoiceActionsPanel({
  invoiceId,
  status,
  balanceDue,
  amountPaid,
  canManage,
}: {
  invoiceId: string;
  status: InvoiceStatus;
  balanceDue: number;
  amountPaid: number;
  canManage: boolean;
}) {
  const [issueState, issueAction, issuePending] = useActionState(issueInvoiceAction.bind(null, invoiceId), INITIAL);
  const [paymentState, paymentAction, paymentPending] = useActionState(recordManualPaymentAction.bind(null, invoiceId), INITIAL);
  const [cancelState, cancelAction, cancelPending] = useActionState(cancelInvoiceAction.bind(null, invoiceId), INITIAL);

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
