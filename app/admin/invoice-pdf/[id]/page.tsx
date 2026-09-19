import { notFound } from "next/navigation";
import { requireModuleAccess, requireRole } from "../../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { PRINT_WHEN_READY_SCRIPT } from "../../../../lib/print-when-ready";
import { PAYMENT_PROVIDER_LABELS, type InvoiceRow, type InvoiceItemRow, type InvoicePaymentRow } from "../../../../lib/sales/invoices";
import { DocumentFooter, DocumentHeader } from "../../../../components/admin/documents/DocumentHeader";
import { invoicePaymentTerms, paymentInstructions } from "../../../../lib/documents/company";
import { quotationTrainingDetailsSchema } from "../../../../lib/validation/schemas";
import { estimateBlockHeight, paginateMeasuredBlocks } from "../../../../lib/documents/pagination";

export const metadata = { title: "Invoice PDF — TERAS UNIVERSAL", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const SANS = "Montserrat, Poppins, Inter, 'Helvetica Neue', Helvetica, Arial, sans-serif";

function fmt(n: number) {
  return `RM ${Number(n).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;
}
function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" });
}

function taxDisplayLabel(label: string | null, rate: number) {
  const base = label?.trim() || "SST";
  return rate > 0 ? `${base} (${rate}%)` : base;
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

  const { data: quotation } = await supabase.from("sales_quotations").select("quotation_no, training_details").eq("id", inv.quotation_id).maybeSingle();
  const trainingResult = quotationTrainingDetailsSchema.safeParse(quotation?.training_details);
  const training = trainingResult.success ? trainingResult.data : null;
  const showTax = inv.sst_applicable === true || (inv.sst_applicable === null && Number(inv.tax_amount) > 0);
  const taxLabel = taxDisplayLabel(inv.tax_label_snapshot, Number(inv.tax_rate));
  const { data: itemRows } = await supabase.from("invoice_items").select("*").eq("invoice_id", id).order("sort_order");
  const items = (itemRows ?? []) as InvoiceItemRow[];
  const { data: paymentRows } = await supabase.from("invoice_payments").select("*").eq("invoice_id", id).order("created_at", { ascending: true });
  // "Payments Received" must only ever list successful payments -- a
  // pending ToyyibPay attempt (paid_at is null, per Phase 2A's corrected
  // semantics) has not been received and must never appear on a printed
  // invoice as if it had.
  const payments = ((paymentRows ?? []) as InvoicePaymentRow[]).filter((p) => p.status === "successful");

  const finalReserve = 290 + estimateBlockHeight(`${inv.payment_terms ?? ""}\n${inv.notes ?? ""}`, 92, 14, 24) + payments.length * 28;
  const itemBlocks = items.map((item) => ({
    id: item.id,
    value: item,
    height: estimateBlockHeight([item.course_name_snapshot, item.description, item.package_includes_snapshot?.map((entry) => entry.label).join(" · ")].filter(Boolean).join("\n"), 68, 14, 30),
  }));
  const itemChunks = paginateMeasuredBlocks(itemBlocks, {
    firstPageHeight: Math.max(260, 670 - (training ? 170 : 0)),
    continuationPageHeight: 820,
    finalPageReserve: finalReserve,
  });
  const pageCount = itemChunks.length;
  const renderItems = (rows: InvoiceItemRow[]) => (
    <table className="inv-pdf-table" style={{ marginBottom: 16 }}>
      <thead>
        <tr style={{ background: "#f3f5f9", textAlign: "left" }}>
          <th style={{ padding: "8px 6px" }}>Description</th>
          <th style={{ padding: "8px 6px", textAlign: "right" }}>Qty</th>
          <th style={{ padding: "8px 6px", textAlign: "right" }}>Unit</th>
          <th style={{ padding: "8px 6px", textAlign: "right" }}>Unit Price</th>
          <th style={{ padding: "8px 6px", textAlign: "right" }}>Discount</th>
          <th style={{ padding: "8px 6px", textAlign: "right" }}>Line Total</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((item) => (
          <tr key={item.id} style={{ borderBottom: "1px solid #eef1f6" }}>
            <td style={{ padding: "8px 6px" }}><strong>{item.course_name_snapshot || ""}</strong>{item.course_name_snapshot && <br />}{item.description}{item.package_includes_snapshot?.length > 0 && <div style={{ color: "#667085", fontSize: 11, marginTop: 4 }}>Package includes: {item.package_includes_snapshot.map((entry) => String(entry.label ?? "")).filter(Boolean).join(" · ")}</div>}</td>
            <td style={{ padding: "8px 6px", textAlign: "right" }}>{item.quantity}</td>
            <td style={{ padding: "8px 6px", textAlign: "right" }}>{item.unit}</td>
            <td style={{ padding: "8px 6px", textAlign: "right" }}>{fmt(item.unit_price)}</td>
            <td style={{ padding: "8px 6px", textAlign: "right" }}>{fmt(item.discount)}</td>
            <td style={{ padding: "8px 6px", textAlign: "right" }}>{fmt(item.line_total)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div className="inv-pdf-shell" style={{ background: "#eef1f6", minHeight: "100vh", padding: 20, fontFamily: SANS }}>
      <style>{`
        @page { size: A4 portrait; margin: 0; }
        .teras-document-header { display: flex; justify-content: space-between; gap: 28px; border-bottom: 3px solid #0B3A63; padding-bottom: 16px; margin-bottom: 24px; }
        .teras-document-brand { min-width: 0; }
        .teras-document-logo { width: 188px; height: auto; object-fit: contain; object-position: left center; }
        .teras-document-company { margin-top: 7px; color: #0B3A63; font-size: 10px; font-weight: 700; letter-spacing: 1px; }
        .teras-document-registration, .teras-document-address { color: #667085; font-size: 10px; line-height: 1.45; }
        .teras-document-registration { margin-top: 4px; }
        .teras-document-address { max-width: 290px; margin-top: 5px; }
        .teras-document-identity { text-align: right; }
        .teras-document-title { color: #0B3A63; font-size: 25px; font-weight: 800; letter-spacing: 2px; }
        .teras-document-meta { display: grid; gap: 5px; margin-top: 10px; color: #667085; font-size: 11px; }
        .teras-document-meta-row { display: grid; grid-template-columns: 1fr auto; gap: 22px; }
        .teras-document-meta-row strong { color: #1a2233; }
        .inv-pdf-section { margin: 22px 0; padding-top: 10px; border-top: 1px solid #d9e1ea; }
        .inv-pdf-section-title { margin: 0 0 8px; color: #0B3A63; font-size: 10px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; }
        .inv-pdf-summary { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 12px; }
        .inv-pdf-summary > div { padding: 9px 11px; border: 1px solid #e3e9f0; }
        .inv-pdf-summary small { display: block; margin-bottom: 4px; color: #667085; font-size: 10px; text-transform: uppercase; }
        .inv-pdf-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 12px; font-variant-numeric: tabular-nums; }
        .inv-pdf-table th { padding: 8px 6px; background: #0B3A63; color: white; text-align: left; }
        .inv-pdf-table td { padding: 8px 6px; border-bottom: 1px solid #d9e1ea; vertical-align: top; }
        .inv-pdf-table th:not(:first-child), .inv-pdf-table td:not(:first-child) { text-align: right; }
        .inv-pdf-table th:first-child, .inv-pdf-table td:first-child { width: 48%; }
        .inv-pdf-table th:nth-child(2), .inv-pdf-table td:nth-child(2) { width: 7%; }
        .inv-pdf-table th:nth-child(3), .inv-pdf-table td:nth-child(3) { width: 10%; }
        .inv-pdf-table th:nth-child(n+4), .inv-pdf-table td:nth-child(n+4) { white-space: nowrap; }
        .inv-pdf-table th:nth-child(4), .inv-pdf-table td:nth-child(4) { width: 13%; }
        .inv-pdf-table th:nth-child(5), .inv-pdf-table td:nth-child(5) { width: 11%; }
        .inv-pdf-table th:nth-child(6), .inv-pdf-table td:nth-child(6) { width: 11%; }
        .inv-pdf-total { font-size: 14px; font-weight: 800; color: #0B3A63; border-top: 2px solid #0B3A63; border-bottom: 2px solid #D4AF37; }
        .inv-pdf-balance { display: flex; justify-content: space-between; gap: 16px; padding: 10px 12px; background: #f5f8fb; border-left: 4px solid #D4AF37; font-size: 15px; font-weight: 800; color: #0B3A63; }
        .teras-document-running-footer { position: absolute; bottom: 22px; left: 56px; right: 56px; padding-top: 8px; border-top: 1px solid #d9e1ea; background: #fff; color: #667085; font-size: 8px; display: flex; justify-content: space-between; gap: 12px; }
        @media print {
          html, body { margin: 0 !important; padding: 0 !important; }
          .inv-pdf-shell { padding: 0 !important; min-height: 0 !important; background: #fff !important; }
          .inv-pdf-page { box-shadow: none !important; margin: 0 !important; }
          .teras-document-running-footer { position: absolute; bottom: 8mm; left: 15mm; right: 15mm; }
          .teras-document-logo { width: 118px; }
          .teras-document-header, .inv-pdf-summary, .inv-pdf-total, .inv-pdf-balance { break-inside: avoid; page-break-inside: avoid; }
          .inv-pdf-section { margin: 11px 0; padding-top: 6px; }
          .inv-pdf-table thead { display: table-header-group; }
          .inv-pdf-table tr { break-inside: avoid; page-break-inside: avoid; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
      `}</style>
      {itemChunks.map((chunk, pageIndex) => {
        const isFirstPage = pageIndex === 0;
        const isLastPage = pageIndex === pageCount - 1;
        return (
          <div key={pageIndex} className="inv-pdf-page" style={{ width: 794, minHeight: 1123, margin: "0 auto", background: "#fff", boxShadow: "0 0 0 1px rgba(0,0,0,.06)", padding: "48px 56px 72px", boxSizing: "border-box", color: "#1a2233", position: "relative", breakAfter: isLastPage ? "auto" : "page", pageBreakAfter: isLastPage ? "auto" : "always" }}>
            {isFirstPage && <>
              <DocumentHeader type="INVOICE" identity={[{ label: "Invoice No.", value: inv.invoice_no }, { label: "Invoice Date", value: fmtDate(inv.invoice_date) }, { label: "Due Date", value: fmtDate(inv.due_date) }, { label: "Quotation Ref.", value: quotation?.quotation_no ?? "—" }]} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 24, fontSize: 12.5 }}>
                <div>
                  <div style={{ fontSize: 11, color: "#667085", textTransform: "uppercase", marginBottom: 4 }}>Bill To</div>
                  <div style={{ fontWeight: 700 }}>{inv.billing_name}</div>
                  {inv.billing_company && <div>{inv.billing_company}</div>}
                  {inv.billing_registration_no && <div style={{ color: "#667085" }}>Reg. No. {inv.billing_registration_no}</div>}
                  {inv.billing_address && <div style={{ whiteSpace: "pre-wrap" }}>{inv.billing_address}</div>}
                  {inv.training_service_address_snapshot && <div style={{ marginTop: 6, whiteSpace: "pre-wrap", color: "#667085" }}>Training / Service Address: {inv.training_service_address_snapshot}</div>}
                  {inv.billing_email && <div>{inv.billing_email}</div>}
                  {inv.billing_phone && <div>{inv.billing_phone}</div>}
                </div>
              </div>
              {training && <section className="inv-pdf-section"><h2 className="inv-pdf-section-title">Training / Programme Summary</h2><div className="inv-pdf-summary"><div><small>Programme</small><strong>{training.programme.course_name_snapshot}</strong></div><div><small>Training Dates</small>{training.programme.start_date || "—"} → {training.programme.end_date || "—"}</div><div><small>Venue</small>{training.venue.name || (training.venue.type === "teras_hq" ? "TERAS HQ" : "In-House")}</div><div><small>Participants</small>{training.participants.count} Pax{training.participants.tbc ? " (TBC)" : ""}</div></div></section>}
            </>}
            {renderItems(chunk)}
            {isLastPage && <>
              <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 24 }}><table style={{ fontSize: 12.5, minWidth: 260 }}><tbody>
                <tr><td style={{ padding: "3px 0", color: "#667085" }}>Subtotal</td><td style={{ padding: "3px 0", textAlign: "right" }}>{fmt(inv.subtotal)}</td></tr>
                <tr><td style={{ padding: "3px 0", color: "#667085" }}>Discount</td><td style={{ padding: "3px 0", textAlign: "right" }}>− {fmt(inv.discount_amount)}</td></tr>
                {showTax && <tr><td style={{ padding: "3px 0", color: "#667085" }}>{taxLabel}</td><td style={{ padding: "3px 0", textAlign: "right" }}>{fmt(inv.tax_amount)}</td></tr>}
                <tr className="inv-pdf-total"><td style={{ padding: "6px 0", fontWeight: 800 }}>Grand Total</td><td style={{ padding: "6px 0", textAlign: "right", fontWeight: 800 }}>{fmt(inv.grand_total)}</td></tr>
                <tr><td style={{ padding: "3px 0", color: "#667085" }}>Amount Paid</td><td style={{ padding: "3px 0", textAlign: "right" }}>{fmt(inv.amount_paid)}</td></tr>
                <tr><td colSpan={2}><div className="inv-pdf-balance"><span>Balance Due</span><span>{fmt(inv.balance_due)}</span></div></td></tr>
              </tbody></table></div>
              {payments.length > 0 && <div style={{ marginBottom: 20 }}><div style={{ fontSize: 11, color: "#667085", textTransform: "uppercase", marginBottom: 6 }}>Payments Received</div><table style={{ width: "100%", fontSize: 11.5, borderCollapse: "collapse" }}><tbody>{payments.map((p) => <tr key={p.id} style={{ borderBottom: "1px solid #eef1f6" }}><td style={{ padding: "4px 0" }}>{fmtDate(p.paid_at)}</td><td style={{ padding: "4px 0" }}>{PAYMENT_PROVIDER_LABELS[p.payment_provider]}{p.payment_reference ? ` (${p.payment_reference})` : ""}</td><td style={{ padding: "4px 0", textAlign: "right" }}>{fmt(receivedAmount(p))}</td></tr>)}</tbody></table></div>}
              <section className="inv-pdf-section"><h2 className="inv-pdf-section-title">Invoice Terms</h2><div style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{invoicePaymentTerms(inv.due_date, fmtDate)}</div>{inv.payment_terms?.trim() && <div style={{ whiteSpace: "pre-wrap", marginTop: 6, fontSize: 12 }}>{inv.payment_terms.trim()}</div>}</section>
              <div className="inv-pdf-section" style={{ fontSize: 11, color: "#667085" }}><div style={{ textTransform: "uppercase", marginBottom: 4 }}>Payment Instructions</div><div>{paymentInstructions(inv.invoice_no)}</div></div>
              {inv.notes && <div style={{ marginTop: 16, fontSize: 11.5, color: "#667085" }}>{inv.notes}</div>}
            </>}
            <DocumentFooter documentNumber={inv.invoice_no} customerName={inv.billing_company || inv.billing_name} pageNumber={pageIndex + 1} pageCount={pageCount} />
          </div>
        );
      })}
      <script dangerouslySetInnerHTML={{ __html: PRINT_WHEN_READY_SCRIPT }} />
    </div>
  );
}
