"use client";

import { useActionState } from "react";
import { Card, Field } from "../../../../../components/admin/ui";
import { updateInvoiceDraft, type InvoiceActionState } from "../actions";

const INITIAL: InvoiceActionState = {};

export function InvoiceDraftForm({
  invoiceId,
  initial,
}: {
  invoiceId: string;
  initial: {
    invoice_date: string;
    due_date: string;
    billing_name: string;
    billing_company: string | null;
    billing_registration_no: string | null;
    billing_address: string | null;
    billing_email: string | null;
    billing_phone: string | null;
    notes: string | null;
    payment_terms: string | null;
  };
}) {
  const [state, action, pending] = useActionState(updateInvoiceDraft.bind(null, invoiceId), INITIAL);

  return (
    <Card title="Draft — Billing Details">
      <form action={action} className="ta-card-pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {state.message && <div className="ta-alert ta-alert-error">{state.message}</div>}
        <p style={{ margin: 0, fontSize: 13, color: "var(--ta-muted)" }}>
          Line items and totals were copied from the accepted quotation and cannot be edited here — only billing details, dates, notes, and payment terms.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field label="Invoice date" name="invoice_date" error={state.errors?.invoice_date} required>
            <input type="date" name="invoice_date" defaultValue={initial.invoice_date} required />
          </Field>
          <Field label="Due date" name="due_date" error={state.errors?.due_date} required>
            <input type="date" name="due_date" defaultValue={initial.due_date} required />
          </Field>
        </div>
        <Field label="Billing name" name="billing_name" error={state.errors?.billing_name} required>
          <input type="text" name="billing_name" defaultValue={initial.billing_name} maxLength={200} required />
        </Field>
        <Field label="Billing company" name="billing_company" error={state.errors?.billing_company}>
          <input type="text" name="billing_company" defaultValue={initial.billing_company ?? ""} maxLength={200} />
        </Field>
        <Field label="Company registration no." name="billing_registration_no" error={state.errors?.billing_registration_no}>
          <input type="text" name="billing_registration_no" defaultValue={initial.billing_registration_no ?? ""} maxLength={100} />
        </Field>
        <Field label="Billing address" name="billing_address" error={state.errors?.billing_address}>
          <textarea name="billing_address" rows={3} defaultValue={initial.billing_address ?? ""} maxLength={1000} />
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field label="Billing email" name="billing_email" error={state.errors?.billing_email}>
            <input type="email" name="billing_email" defaultValue={initial.billing_email ?? ""} maxLength={200} />
          </Field>
          <Field label="Billing phone" name="billing_phone" error={state.errors?.billing_phone}>
            <input type="text" name="billing_phone" defaultValue={initial.billing_phone ?? ""} maxLength={50} />
          </Field>
        </div>
        <Field label="Payment terms" name="payment_terms" error={state.errors?.payment_terms}>
          <textarea name="payment_terms" rows={2} defaultValue={initial.payment_terms ?? ""} maxLength={3000} />
        </Field>
        <Field label="Notes" name="notes" error={state.errors?.notes}>
          <textarea name="notes" rows={2} defaultValue={initial.notes ?? ""} maxLength={3000} />
        </Field>
        <button type="submit" className="ta-btn ta-btn-primary ta-btn-sm" disabled={pending} style={{ alignSelf: "flex-start" }}>
          {pending ? "Saving…" : "Save Changes"}
        </button>
      </form>
    </Card>
  );
}
