import Image from "next/image";
import { notFound } from "next/navigation";
import { requireModuleAccess, requireRole } from "../../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { PRINT_WHEN_READY_SCRIPT } from "../../../../lib/print-when-ready";
import { PAYMENT_PROVIDER_LABELS, type InvoiceRow, type InvoiceItemRow, type InvoicePaymentRow } from "../../../../lib/sales/invoices";

export const metadata = { title: "Invoice PDF — TERAS UNIVERSAL", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const REG_NO = "201201003207 (976732-P)";
const OFFICE_ADDRESS = "Lot 1961, Jalan Tanah Merah, Kg. Tanah Merah Dalam, 06000 Jitra, Kedah.";
const NAVY = "#0B3A63";
const MUTED = "#667085";
const BORDER = "#D9E1EA";
const SANS = "'Helvetica Neue',Helvetica,Arial,sans-serif";

function fmt(n: number) {
  return `RM ${Number(n).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;
}
function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Phase 2E fix: the amount actually received for a payment row -- `amount`
 * for manual payments (there is no separate verified concept for those),
 * but `verified_amount` for a successful ToyyibPay row, since `amount` is
 * only ever the originally-requested bill amount and can legitimately
 * differ from what the provider actually confirmed (see the underpayment
 * defect this was written to fix). enforce_toyyibpay_attempt_transition
 * already guarantees verified_amount is non-null on every successful
 * toyyibpay row, so the null branch below should be unreachable -- if it
 * ever fires, that's a real data-integrity problem, not a missing amount
 * to paper over by falling back to the unverified requested amount.
 */
function receivedAmount(p: InvoicePaymentRow): number {
  if (p.payment_provider !== "toyyibpay") return p.amount;
  if (p.verified_amount === null) {
    throw new Error(`Invoice PDF data-integrity error: successful ToyyibPay payment ${p.id} has no verified_amount.`);
  }
  return p.verified_amount;
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

  const { data: itemRows } = await supabase.from("invoice_items").select("*").eq("invoice_id", id).order("sort_order");
  const items = (itemRows ?? []) as InvoiceItemRow[];
  const { data: paymentRows } = await supabase.from("invoice_payments").select("*").eq("invoice_id", id).order("created_at", { ascending: true });
  // "Payments Received" must only ever list successful payments -- a
  // pending ToyyibPay attempt (paid_at is null, per Phase 2A's corrected
  // semantics) has not been received and must never appear on a printed
  // invoice as if it had.
  const payments = ((paymentRows ?? []) as InvoicePaymentRow[]).filter((p) => p.status === "successful");
  const showTax = inv.sst_applicable === true || (inv.sst_applicable === null && Number(inv.tax_amount) > 0);
  const taxLabel = inv.tax_label_snapshot?.trim() || (inv.tax_rate > 0 ? `SST ${inv.tax_rate}%` : "Tax");

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
      <div className="inv-pdf-page" style={{ width: 794, minHeight: 1123, margin: "0 auto", background: "#fff", boxShadow: "0 0 0 1px rgba(0,0,0,.06)", padding: "44px 52px 34px", boxSizing: "border-box", color: "#333" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: `3px solid ${NAVY}`, paddingBottom: 18, marginBottom: 24, gap: 28 }}>
          <div>
            <Image src="/teras-universal-logo.png" alt="TERAS Universal" width={166} height={118} priority style={{ width: 166, height: "auto", objectFit: "contain", objectPosition: "left center" }} />
            <div style={{ marginTop: 8, fontSize: 17, fontWeight: 800, color: NAVY }}>TERAS UNIVERSAL SDN. BHD.</div>
            <div style={{ marginTop: 4, fontSize: 10, color: MUTED }}>Company Registration No. {REG_NO}</div>
            <div style={{ maxWidth: 290, marginTop: 5, fontSize: 10, lineHeight: 1.45, color: MUTED }}>{OFFICE_ADDRESS}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 25, fontWeight: 800, letterSpacing: 2, color: NAVY }}>INVOICE</div>
            <div style={{ display: "grid", gridTemplateColumns: "auto auto", gap: "5px 22px", marginTop: 10, color: MUTED, fontSize: 11 }}>
              <span>Invoice No.</span><strong style={{ color: "#333" }}>{inv.invoice_no}</strong>
              <span>Invoice Date</span><strong style={{ color: "#333" }}>{fmtDate(inv.invoice_date)}</strong>
              <span>Due Date</span><strong style={{ color: "#333" }}>{fmtDate(inv.due_date)}</strong>
              <span>Status</span><strong style={{ color: "#333", textTransform: "capitalize" }}>{inv.status.replace("_", " ")}</strong>
            </div>
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
            {inv.quotation_number_snapshot && <div><span style={{ color: MUTED }}>Quotation Ref: </span>{inv.quotation_number_snapshot}</div>}
          </div>
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginBottom: 16 }}>
          <thead>
              <tr style={{ background: NAVY, color: "#fff", textAlign: "left" }}>
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
                <td style={{ padding: "8px 6px" }}>
                  {item.course_name_snapshot && <div style={{ fontWeight: 700 }}>{item.course_name_snapshot}{item.hrdf_claim ? " (HRDF)" : ""}</div>}
                  <div>{item.description}</div>
                  {item.package_includes_snapshot.length > 0 && <div style={{ color: "#667085", fontSize: 11 }}>Package Includes: {item.package_includes_snapshot.map((entry) => String(entry.label ?? entry.key ?? "")).filter(Boolean).join(", ")}</div>}
                </td>
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
              {inv.discount_amount > 0 && <tr><td style={{ padding: "3px 0", color: MUTED }}>Discount</td><td style={{ padding: "3px 0", textAlign: "right" }}>− {fmt(inv.discount_amount)}</td></tr>}
              {showTax && <tr><td style={{ padding: "3px 0", color: MUTED }}>{taxLabel}</td><td style={{ padding: "3px 0", textAlign: "right" }}>{fmt(inv.tax_amount)}</td></tr>}
              <tr style={{ borderTop: `2px solid ${NAVY}` }}><td style={{ padding: "6px 0", fontWeight: 800, color: NAVY }}>Grand Total</td><td style={{ padding: "6px 0", textAlign: "right", fontWeight: 800, color: NAVY }}>{fmt(inv.grand_total)}</td></tr>
              <tr><td style={{ padding: "3px 0", color: MUTED }}>Amount Paid</td><td style={{ padding: "3px 0", textAlign: "right" }}>{fmt(inv.amount_paid)}</td></tr>
              <tr><td style={{ padding: "3px 0", fontWeight: 800 }}>Balance Due</td><td style={{ padding: "3px 0", textAlign: "right", fontWeight: 800 }}>{fmt(inv.balance_due)}</td></tr>
            </tbody>
          </table>
        </div>

        {inv.training_service_address_snapshot && (
          <div style={{ marginBottom: 16, fontSize: 12 }}>
            <div style={{ fontSize: 11, color: "#667085", textTransform: "uppercase", marginBottom: 4 }}>Training / Service Address</div>
            <div style={{ whiteSpace: "pre-wrap" }}>{inv.training_service_address_snapshot}</div>
          </div>
        )}

        {payments.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, color: MUTED, textTransform: "uppercase", marginBottom: 6 }}>Payments Received</div>
            <table style={{ width: "100%", fontSize: 11.5, borderCollapse: "collapse" }}>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} style={{ borderBottom: "1px solid #eef1f6" }}>
                    <td style={{ padding: "4px 0" }}>{fmtDate(p.paid_at)}</td>
                    <td style={{ padding: "4px 0" }}>{p.payment_source === "hrdf" ? "HRDF" : PAYMENT_PROVIDER_LABELS[p.payment_provider]}{p.payment_reference ? ` (${p.payment_reference})` : ""}</td>
                    <td style={{ padding: "4px 0", textAlign: "right" }}>{fmt(receivedAmount(p))}</td>
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
        <div style={{ marginTop: 24, paddingTop: 12, borderTop: `1px solid ${BORDER}`, fontSize: 11, color: MUTED }}>
          <div style={{ textTransform: "uppercase", marginBottom: 4 }}>Payment Instructions</div>
          <div>Please quote invoice number {inv.invoice_no} as payment reference.</div>
        </div>

        {inv.notes && (
          <div style={{ marginTop: 16, fontSize: 11.5, color: "#667085" }}>{inv.notes}</div>
        )}
        <footer style={{ marginTop: 28, paddingTop: 12, borderTop: `1px solid ${BORDER}`, color: MUTED, fontSize: 10, lineHeight: 1.45 }}>
          Thank you for the opportunity to serve you. Please refer to the invoice number in all correspondence with TERAS UNIVERSAL SDN. BHD.
        </footer>
      </div>
      <script dangerouslySetInnerHTML={{ __html: PRINT_WHEN_READY_SCRIPT }} />
    </div>
  );
}
