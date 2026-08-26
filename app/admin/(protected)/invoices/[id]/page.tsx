import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { requireRole, requireModuleAccess } from "../../../../../lib/auth/session";
import { isAdmin } from "../../../../../lib/auth/rbac";
import { PageHead, Card, Badge, EmptyState } from "../../../../../components/admin/ui";
import {
  effectiveInvoiceStatus,
  PAYMENT_PROVIDER_LABELS,
  type InvoiceRow,
  type InvoiceItemRow,
  type InvoicePaymentRow,
} from "../../../../../lib/sales/invoices";
import { getToyyibpayCapability } from "../../../../../lib/payments/toyyibpay";
import { InvoiceDraftForm } from "./InvoiceDraftForm";
import { InvoiceActionsPanel } from "./InvoiceActionsPanel";

export const metadata = { title: "Invoice Detail — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

function fmt(n: number) {
  return `RM ${Number(n).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;
}
function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" });
}
function fmtDateTime(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-MY", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireRole("editor");
  await requireModuleAccess("invoices");
  const canManage = isAdmin(profile.role);
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  // Phase 2F production-visibility guard. Computed server-side via
  // getToyyibpayCapability() (lib/payments/toyyibpay.ts), which reads only
  // TOYYIBPAY_ENV (a mode string, never NEXT_PUBLIC_*) -- only the derived
  // `enabled`/`isSandbox` booleans cross into the client component's props,
  // never the raw env value and never TOYYIBPAY_USER_SECRET_KEY/
  // TOYYIBPAY_CATEGORY_CODE. A deployment with TOYYIBPAY_ENV unset or set
  // to anything other than "sandbox"/"production" gets no ToyyibPay card at
  // all -- not a disabled one, not a dead-end button, simply absent. The
  // resolver's own hard fail-closed gate (lib/payments/toyyibpay.ts) stays
  // as defense-in-depth regardless of what this flag renders -- this flag
  // is a UX guard, not the actual security boundary.
  const toyyibpayCapability = getToyyibpayCapability();
  const toyyibpayEnabled = toyyibpayCapability.enabled;
  const toyyibpayIsSandbox = toyyibpayCapability.isSandbox;

  const { data: invoice } = await supabase.from("invoices").select("*").eq("id", id).maybeSingle();
  if (!invoice) notFound();
  const inv = invoice as InvoiceRow;

  const { data: quotation } = await supabase.from("sales_quotations").select("id, quotation_no").eq("id", inv.quotation_id).maybeSingle();
  const { data: opportunity } = await supabase.from("sales_opportunities").select("id, opportunity_no, company_name").eq("id", inv.opportunity_id).maybeSingle();
  const { data: itemRows } = await supabase.from("invoice_items").select("*").eq("invoice_id", id).order("sort_order");
  const items = (itemRows ?? []) as InvoiceItemRow[];
  const { data: paymentRows } = await supabase.from("invoice_payments").select("*").eq("invoice_id", id).order("created_at", { ascending: false });
  const payments = (paymentRows ?? []) as InvoicePaymentRow[];
  // Most recent row already first (query is ordered desc) -- the ToyyibPay
  // card reflects this persisted state directly rather than re-deriving it,
  // so it shows correctly on first load, not just right after a Generate
  // click. Next.js's revalidatePath (already called by every ToyyibPay
  // Server Action) refreshes this prop automatically once an action
  // completes -- no separate client-side sync logic needed.
  const latestToyyibpayAttempt = payments.find((p) => p.payment_provider === "toyyibpay") ?? null;

  return (
    <>
      <PageHead
        title={inv.invoice_no}
        subtitle={[
          quotation ? `from ${quotation.quotation_no}` : undefined,
          opportunity ? `${opportunity.opportunity_no} — ${opportunity.company_name ?? "No company on file"}` : undefined,
        ].filter(Boolean).join(" · ")}
        action={
          <div style={{ display: "flex", gap: 8 }}>
            {opportunity && <Link href={`/admin/sales/opportunities/${opportunity.id}`} className="ta-btn ta-btn-outline">← Opportunity</Link>}
            {inv.status !== "draft" && <Link href={`/admin/invoice-pdf/${id}`} target="_blank" className="ta-btn ta-btn-outline">🖨 Print / PDF</Link>}
          </div>
        }
      />

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
        <Badge status={effectiveInvoiceStatus(inv)} />
        <span style={{ color: "var(--ta-muted)", fontSize: 13 }}>Invoice date {fmtDate(inv.invoice_date)} · Due {fmtDate(inv.due_date)}</span>
      </div>

      <div className="ta-invoice-detail-grid">
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {inv.status === "draft" && canManage && (
            <InvoiceDraftForm
              invoiceId={id}
              initial={{
                invoice_date: inv.invoice_date,
                due_date: inv.due_date,
                billing_name: inv.billing_name,
                billing_company: inv.billing_company,
                billing_registration_no: inv.billing_registration_no,
                billing_address: inv.billing_address,
                billing_email: inv.billing_email,
                billing_phone: inv.billing_phone,
                notes: inv.notes,
                payment_terms: inv.payment_terms,
              }}
            />
          )}

          <Card title="Bill To">
            <div className="ta-card-pad" style={{ fontSize: 14, lineHeight: 1.6 }}>
              <strong>{inv.billing_name}</strong>
              {inv.billing_company && <div>{inv.billing_company}</div>}
              {inv.billing_registration_no && <div style={{ color: "var(--ta-muted)", fontSize: 12 }}>Reg. No. {inv.billing_registration_no}</div>}
              {inv.billing_address && <div style={{ whiteSpace: "pre-wrap" }}>{inv.billing_address}</div>}
              {inv.billing_email && <div>{inv.billing_email}</div>}
              {inv.billing_phone && <div>{inv.billing_phone}</div>}
            </div>
          </Card>

          <Card title="Line Items">
            {items.length > 0 ? (
              <div className="ta-table-wrap">
                <table className="ta-table">
                  <thead><tr><th>Description</th><th>Qty</th><th>Unit</th><th>Unit Price</th><th>Discount</th><th>Line Total</th></tr></thead>
                  <tbody>
                    {items.map((item) => (
                      <tr key={item.id}>
                        <td>{item.description}</td>
                        <td>{item.quantity}</td>
                        <td>{item.unit}</td>
                        <td>{fmt(item.unit_price)}</td>
                        <td>{fmt(item.discount)}</td>
                        <td>{fmt(item.line_total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState message="No line items." />
            )}
            <div className="ta-card-pad" style={{ borderTop: "1px solid var(--ta-line)" }}>
              <dl style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 6, margin: 0, maxWidth: 320, marginLeft: "auto" }}>
                <dt>Subtotal</dt><dd style={{ margin: 0, textAlign: "right" }}>{fmt(inv.subtotal)}</dd>
                <dt>Discount</dt><dd style={{ margin: 0, textAlign: "right" }}>− {fmt(inv.discount_amount)}</dd>
                <dt>Tax {inv.tax_rate > 0 ? `(SST ${inv.tax_rate}%)` : "(not applicable)"}</dt><dd style={{ margin: 0, textAlign: "right" }}>{fmt(inv.tax_amount)}</dd>
                <dt><strong>Grand Total</strong></dt><dd style={{ margin: 0, textAlign: "right" }}><strong>{fmt(inv.grand_total)}</strong></dd>
                <dt>Amount Paid</dt><dd style={{ margin: 0, textAlign: "right" }}>{fmt(inv.amount_paid)}</dd>
                <dt><strong>Balance Due</strong></dt><dd style={{ margin: 0, textAlign: "right" }}><strong>{fmt(inv.balance_due)}</strong></dd>
              </dl>
              {inv.payment_terms && (
                <>
                  <h4 style={{ fontSize: 13, color: "var(--ta-muted)", margin: "16px 0 6px" }}>Payment Terms</h4>
                  <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{inv.payment_terms}</p>
                </>
              )}
            </div>
          </Card>

          <Card title="Payment History">
            {payments.length > 0 ? (
              <div className="ta-table-wrap">
                <table className="ta-table">
                  <thead><tr><th>Paid</th><th>Method</th><th>Amount</th><th>Reference</th><th>Status</th></tr></thead>
                  <tbody>
                    {payments.map((p) => (
                      <tr key={p.id}>
                        <td>{fmtDate(p.paid_at)}</td>
                        <td>{PAYMENT_PROVIDER_LABELS[p.payment_provider]}{p.payment_method ? ` — ${p.payment_method}` : ""}</td>
                        <td>{fmt(p.amount)}</td>
                        <td>
                          {p.payment_provider === "toyyibpay" && p.status === "successful"
                            ? (p.provider_transaction_id ?? p.provider_bill_code ?? "—")
                            : (p.payment_reference ?? p.provider_bill_code ?? "—")}
                          {p.payment_provider === "toyyibpay" && p.status === "pending" && p.payment_url && (
                            <>
                              {" "}
                              <a href={p.payment_url} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
                                {toyyibpayIsSandbox ? "(open sandbox link ↗)" : "(open payment link ↗)"}
                              </a>
                              <div style={{ fontSize: 11, color: "var(--ta-muted)" }}>Requested {fmtDateTime(p.created_at)}</div>
                            </>
                          )}
                          {p.payment_provider === "toyyibpay" && p.status === "successful" && p.verified_amount !== null && (
                            <div style={{ fontSize: 11, color: "var(--ta-muted)" }}>
                              ✓ Provider-verified RM {Number(p.verified_amount).toLocaleString("en-MY", { minimumFractionDigits: 2 })}
                              {p.callback_received_at ? " · via callback" : " · via return-page verification"}
                            </div>
                          )}
                        </td>
                        <td><Badge status={p.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState icon="💳" message="No payments recorded yet." />
            )}
          </Card>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <InvoiceActionsPanel
            invoiceId={id}
            status={inv.status}
            balanceDue={Number(inv.balance_due)}
            amountPaid={Number(inv.amount_paid)}
            canManage={canManage}
            toyyibpayEnabled={toyyibpayEnabled}
            toyyibpayIsSandbox={toyyibpayIsSandbox}
            latestToyyibpayAttempt={latestToyyibpayAttempt}
            invoiceNo={inv.invoice_no}
          />
        </div>
      </div>
    </>
  );
}
