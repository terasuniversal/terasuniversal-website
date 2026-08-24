import { notFound } from "next/navigation";
import { requireModuleAccess, requireRole } from "../../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { PRINT_WHEN_READY_SCRIPT } from "../../../../lib/print-when-ready";
import { PAYMENT_PROVIDER_LABELS, type InvoiceRow, type InvoiceItemRow, type InvoicePaymentRow } from "../../../../lib/sales/invoices";

export const metadata = { title: "Invoice PDF — TERAS UNIVERSAL", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const REG_NO = "202201038223 (1477529-X)";
const SANS = "'Helvetica Neue',Helvetica,Arial,sans-serif";

function fmt(n: number) {
  return `RM ${Number(n).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;
}
function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Print / PDF view — same architecture as /admin/cert-pdf/[id]: outside the
 * (protected) shell (no sidebar) but still under /admin (middleware-
 * protected) and module-gated. Server-rendered HTML + browser print-to-PDF,
 * no PDF library — this codebase has none and the certificate module
 * already proves this path works reliably. Only issued (or later-status)
 * invoices render here; a draft has no frozen totals worth printing yet.
 */
export default async function InvoicePdfPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("editor");
  await requireModuleAccess("invoices");
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: invoice } = await supabase.from("invoices").select("*").eq("id", id).maybeSingle();
  if (!invoice) notFound();
  const inv = invoice as InvoiceRow;
  if (inv.status === "draft") notFound();

  const { data: quotation } = await supabase.from("sales_quotations").select("quotation_no").eq("id", inv.quotation_id).maybeSingle();
  const { data: itemRows } = await supabase.from("invoice_items").select("*").eq("invoice_id", id).order("sort_order");
  const items = (itemRows ?? []) as InvoiceItemRow[];
  const { data: paymentRows } = await supabase.from("invoice_payments").select("*").eq("invoice_id", id).order("paid_at", { ascending: true });
  const payments = (paymentRows ?? []) as InvoicePaymentRow[];

  return (
    <div className="inv-pdf-shell" style={{ background: "#eef1f6", minHeight: "100vh", padding: 20, fontFamily: SANS }}>
      <style>{`
        @page { size: A4 portrait; margin: 0; }
        @media print {
          html, body { margin: 0 !important; padding: 0 !important; }
          .inv-pdf-shell { padding: 0 !important; min-height: 0 !important; background: #fff !important; }
          .inv-pdf-page { box-shadow: none !important; margin: 0 !important; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
      `}</style>
      <div className="inv-pdf-page" style={{ width: 794, minHeight: 1123, margin: "0 auto", background: "#fff", boxShadow: "0 0 0 1px rgba(0,0,0,.06)", padding: "48px 56px", boxSizing: "border-box", color: "#1a2233" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "3px solid #0B3A63", paddingBottom: 16, marginBottom: 24 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#0B3A63" }}>TERAS UNIVERSAL SDN. BHD.</div>
            <div style={{ fontSize: 11, color: "#667085" }}>Reg. No. {REG_NO}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: 1 }}>INVOICE</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>{inv.invoice_no}</div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 24, fontSize: 12.5 }}>
          <div>
            <div style={{ fontSize: 11, color: "#667085", textTransform: "uppercase", marginBottom: 4 }}>Bill To</div>
            <div style={{ fontWeight: 700 }}>{inv.billing_name}</div>
            {inv.billing_company && <div>{inv.billing_company}</div>}
            {inv.billing_registration_no && <div style={{ color: "#667085" }}>Reg. No. {inv.billing_registration_no}</div>}
            {inv.billing_address && <div style={{ whiteSpace: "pre-wrap" }}>{inv.billing_address}</div>}
            {inv.billing_email && <div>{inv.billing_email}</div>}
            {inv.billing_phone && <div>{inv.billing_phone}</div>}
          </div>
          <div style={{ textAlign: "right" }}>
            <div><span style={{ color: "#667085" }}>Invoice Date: </span>{fmtDate(inv.invoice_date)}</div>
            <div><span style={{ color: "#667085" }}>Due Date: </span>{fmtDate(inv.due_date)}</div>
            {quotation && <div><span style={{ color: "#667085" }}>Quotation Ref: </span>{quotation.quotation_no}</div>}
          </div>
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginBottom: 16 }}>
          <thead>
            <tr style={{ background: "#f3f5f9", textAlign: "left" }}>
              <th style={{ padding: "8px 6px" }}>Description</th>
              <th style={{ padding: "8px 6px", textAlign: "right" }}>Qty</th>
              <th style={{ padding: "8px 6px", textAlign: "right" }}>Unit Price</th>
              <th style={{ padding: "8px 6px", textAlign: "right" }}>Discount</th>
              <th style={{ padding: "8px 6px", textAlign: "right" }}>Line Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} style={{ borderBottom: "1px solid #eef1f6" }}>
                <td style={{ padding: "8px 6px" }}>{item.description}</td>
                <td style={{ padding: "8px 6px", textAlign: "right" }}>{item.quantity} {item.unit}</td>
                <td style={{ padding: "8px 6px", textAlign: "right" }}>{fmt(item.unit_price)}</td>
                <td style={{ padding: "8px 6px", textAlign: "right" }}>{fmt(item.discount)}</td>
                <td style={{ padding: "8px 6px", textAlign: "right" }}>{fmt(item.line_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 24 }}>
          <table style={{ fontSize: 12.5, minWidth: 260 }}>
            <tbody>
              <tr><td style={{ padding: "3px 0", color: "#667085" }}>Subtotal</td><td style={{ padding: "3px 0", textAlign: "right" }}>{fmt(inv.subtotal)}</td></tr>
              <tr><td style={{ padding: "3px 0", color: "#667085" }}>Discount</td><td style={{ padding: "3px 0", textAlign: "right" }}>− {fmt(inv.discount_amount)}</td></tr>
              <tr><td style={{ padding: "3px 0", color: "#667085" }}>Tax {inv.tax_rate > 0 ? `(SST ${inv.tax_rate}%)` : ""}</td><td style={{ padding: "3px 0", textAlign: "right" }}>{fmt(inv.tax_amount)}</td></tr>
              <tr style={{ borderTop: "2px solid #0B3A63" }}><td style={{ padding: "6px 0", fontWeight: 800 }}>Grand Total</td><td style={{ padding: "6px 0", textAlign: "right", fontWeight: 800 }}>{fmt(inv.grand_total)}</td></tr>
              <tr><td style={{ padding: "3px 0", color: "#667085" }}>Amount Paid</td><td style={{ padding: "3px 0", textAlign: "right" }}>{fmt(inv.amount_paid)}</td></tr>
              <tr><td style={{ padding: "3px 0", fontWeight: 800 }}>Balance Due</td><td style={{ padding: "3px 0", textAlign: "right", fontWeight: 800 }}>{fmt(inv.balance_due)}</td></tr>
            </tbody>
          </table>
        </div>

        {payments.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, color: "#667085", textTransform: "uppercase", marginBottom: 6 }}>Payments Received</div>
            <table style={{ width: "100%", fontSize: 11.5, borderCollapse: "collapse" }}>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} style={{ borderBottom: "1px solid #eef1f6" }}>
                    <td style={{ padding: "4px 0" }}>{fmtDate(p.paid_at)}</td>
                    <td style={{ padding: "4px 0" }}>{PAYMENT_PROVIDER_LABELS[p.payment_provider]}{p.payment_reference ? ` (${p.payment_reference})` : ""}</td>
                    <td style={{ padding: "4px 0", textAlign: "right" }}>{fmt(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {inv.payment_terms && (
          <div style={{ marginBottom: 16, fontSize: 12 }}>
            <div style={{ fontSize: 11, color: "#667085", textTransform: "uppercase", marginBottom: 4 }}>Payment Terms</div>
            <div style={{ whiteSpace: "pre-wrap" }}>{inv.payment_terms}</div>
          </div>
        )}

        {/*
          Bank/payment instructions placeholder — no real bank account is
          invented here. Phase 2 replaces/extends this block with a ToyyibPay
          Pay Now button + QR once that integration exists; for now it is
          static configuration text only, left blank by default.
        */}
        <div style={{ marginTop: 24, paddingTop: 12, borderTop: "1px solid #eef1f6", fontSize: 11, color: "#667085" }}>
          <div style={{ textTransform: "uppercase", marginBottom: 4 }}>Payment Instructions</div>
          <div>Bank transfer details to be provided by TERAS UNIVERSAL SDN. BHD. Please quote invoice number {inv.invoice_no} as payment reference.</div>
        </div>

        {inv.notes && (
          <div style={{ marginTop: 16, fontSize: 11.5, color: "#667085" }}>{inv.notes}</div>
        )}
      </div>
      <script dangerouslySetInnerHTML={{ __html: PRINT_WHEN_READY_SCRIPT }} />
    </div>
  );
}
