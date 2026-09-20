import { notFound } from "next/navigation";
import { requireModuleAccess, requireRole } from "../../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { DocumentFooter, DocumentHeader } from "../../../../components/admin/documents/DocumentHeader";
import { estimateBlockHeight, paginateMeasuredBlocks } from "../../../../lib/documents/pagination";
import { PAYMENT_PROVIDER_LABELS, type ReceiptRow, type InvoicePaymentProvider } from "../../../../lib/sales/invoices";

export const metadata = { title: "Receipt PDF — TERAS UNIVERSAL", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const SANS = "Montserrat, Poppins, Inter, 'Helvetica Neue', Helvetica, Arial, sans-serif";

function fmt(value: number, currency: string) {
  return `${currency === "MYR" ? "RM" : currency} ${Number(value).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;
}

function fmtDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" });
}

function paymentMethodLabel(providerLabel: string | null, methodLabel: string | null): string {
  const provider = providerLabel?.trim() || "";
  const method = methodLabel?.trim() || "";
  if (!provider) return method || "—";
  if (!method || provider.replace(/\s+/g, " ").toLowerCase() === method.replace(/\s+/g, " ").toLowerCase()) return provider;
  return `${provider} — ${method}`;
}

function splitNotes(value: string | null): string[] {
  if (!value?.trim()) return [];
  const chunks: string[] = [];
  const paragraphs = value.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean);
  let current: string[] = [];
  let currentWordCount = 0;
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/);
    if (current.length > 0 && currentWordCount + words.length > 55) {
      chunks.push(current.join("\n\n"));
      current = [];
      currentWordCount = 0;
    }
    current.push(paragraph);
    currentWordCount += words.length;
  }
  if (current.length > 0) chunks.push(current.join("\n\n"));
  return chunks;
}

export default async function ReceiptPdfPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("editor");
  await requireModuleAccess("invoices");
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: receipt } = await supabase.from("receipts").select("*").eq("id", id).maybeSingle();
  if (!receipt) notFound();
  const row = receipt as ReceiptRow;
  const notePages = paginateMeasuredBlocks(
    splitNotes(row.notes).map((note, index) => ({
      id: `receipt-note-${index}`,
      height: estimateBlockHeight(note, 110, 18, 16),
      value: note,
    })),
    { firstPageHeight: 760, continuationPageHeight: 900, finalPageReserve: 0 },
  );
  const notesFitFirstPage = (notePages[0]?.join("\n").length ?? 0) <= 220;
  const displayNotePages = notesFitFirstPage ? notePages : [[], ...notePages];
  const pageCount = Math.max(1, displayNotePages.length);
  const provider = row.payment_provider_snapshot as InvoicePaymentProvider | null;
  const providerLabel = provider ? PAYMENT_PROVIDER_LABELS[provider] ?? row.payment_provider_snapshot : row.payment_provider_snapshot;
  const identity = [
    { label: "Receipt No.", value: row.receipt_no },
    { label: "Receipt Date", value: fmtDate(row.receipt_date) },
    { label: "Invoice Ref.", value: row.invoice_number_snapshot },
  ];

  return <div className="receipt-print-root"><style>{`
    .receipt-print-root{min-height:100vh;padding:24px;background:#EEF2F6;color:#1D2939;font-family:${SANS};font-size:12px}
    .receipt-print-paper{width:794px;min-height:1123px;box-sizing:border-box;margin:0 auto;padding:44px 52px 64px;background:#fff;box-shadow:0 8px 28px rgba(11,58,99,.12);position:relative;break-after:page;page-break-after:always}
    .receipt-print-paper:last-of-type{break-after:auto;page-break-after:auto}
    .teras-document-header{display:flex;justify-content:space-between;gap:28px;padding-bottom:16px;margin-bottom:24px;border-bottom:3px solid #0B3A63}.teras-document-brand{min-width:0}.teras-document-logo{width:188px;height:auto;object-fit:contain;object-position:left center}.teras-document-company{margin-top:7px;color:#0B3A63;font-size:10px;font-weight:700;letter-spacing:1px}.teras-document-registration,.teras-document-address{color:#667085;font-size:10px;line-height:1.45}.teras-document-registration{margin-top:4px}.teras-document-address{max-width:290px;margin-top:5px}.teras-document-identity{text-align:right}.teras-document-title{color:#0B3A63;font-size:25px;font-weight:800;letter-spacing:2px}.teras-document-meta{display:grid;gap:5px;margin-top:10px;color:#667085;font-size:11px}.teras-document-meta-row{display:grid;grid-template-columns:1fr auto;gap:22px}.teras-document-meta-row strong{color:#1D2939;font-weight:700;white-space:nowrap}
    .receipt-print-section{margin-top:21px;padding-top:10px;border-top:1px solid #E8EDF3}.receipt-print-title{margin:0 0 8px;color:#0B3A63;font-size:10px;font-weight:800;letter-spacing:1.1px;text-transform:uppercase}.receipt-print-title::after{content:"";display:block;width:24px;margin-top:4px;border-bottom:2px solid #D4AF37}
    .receipt-print-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.receipt-print-card{padding:10px 12px;border:1px solid #E3E9F0;line-height:1.45;overflow-wrap:anywhere;min-width:0}.receipt-print-card strong{color:#0B3A63}.receipt-print-detail-label{display:block;margin-bottom:4px;color:#667085;font-size:9px;font-weight:700;letter-spacing:.5px;text-transform:uppercase}.receipt-print-detail-value{display:block;color:#0B3A63;font-weight:700;line-height:1.35;overflow-wrap:anywhere}.receipt-print-value{white-space:pre-wrap;overflow-wrap:anywhere}
    .receipt-print-amount{margin-top:16px;padding:15px 18px;background:#F5F8FB;border-left:5px solid #D4AF37;color:#0B3A63;break-inside:avoid;page-break-inside:avoid}.receipt-print-amount-label{font-size:10px;font-weight:800;letter-spacing:1.1px;text-transform:uppercase}.receipt-print-amount-value{margin-top:5px;font-size:25px;font-weight:800;font-variant-numeric:tabular-nums;white-space:nowrap}
    .receipt-print-summary{width:100%;max-width:360px;margin-left:auto;border-collapse:collapse;font-size:12px;font-variant-numeric:tabular-nums}.receipt-print-summary td{padding:5px 8px;border-bottom:1px solid #E8EDF3}.receipt-print-summary td:last-child{text-align:right;white-space:nowrap}.receipt-print-balance td{border-top:2px solid #0B3A63;border-bottom:2px solid #D4AF37;color:#0B3A63;font-weight:800}
    .receipt-print-void{margin-bottom:16px;padding:8px 12px;border:2px solid #991B1B;color:#991B1B;font-size:16px;font-weight:800;letter-spacing:2px;text-align:center}.receipt-print-refunded{margin-bottom:16px;padding:8px 12px;border:2px solid #9A6700;color:#9A6700;font-size:16px;font-weight:800;letter-spacing:2px;text-align:center}
    .teras-document-running-footer{position:absolute;bottom:22px;left:52px;right:52px;padding-top:8px;border-top:1px solid #D9E1EA;background:#fff;color:#667085;font-size:8px;display:flex;justify-content:space-between;gap:12px}
    @media print{html,body{margin:0!important;padding:0!important}.receipt-print-root{width:auto;min-height:0;padding:0;background:#fff;font-size:10px}.receipt-print-paper{width:210mm;height:297mm;min-height:297mm;margin:0;padding:8mm 12mm 18mm;box-shadow:none;break-after:page;page-break-after:always}.receipt-print-paper:last-of-type{break-after:auto;page-break-after:auto}.teras-document-header{padding-bottom:10px;margin-bottom:14px}.teras-document-logo{width:108px}.teras-document-running-footer{bottom:6mm;left:12mm;right:12mm;padding-top:6px}.receipt-print-section{margin-top:8px;padding-top:5px}.receipt-print-card{padding:6px 8px}.receipt-print-amount{margin-top:8px;padding:8px 12px}.receipt-print-summary td{padding:3px 6px}.teras-document-header,.receipt-print-card,.receipt-print-summary{break-inside:avoid;page-break-inside:avoid}*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}}
  `}</style>{Array.from({ length: pageCount }, (_, pageIndex) => <main className="receipt-print-paper" key={pageIndex}>
    <DocumentHeader type="RECEIPT" identity={identity} />
    {row.status === "refunded" && <div className="receipt-print-refunded">REFUNDED RECEIPT</div>}
    {row.status === "voided" && <div className="receipt-print-void">VOIDED RECEIPT</div>}
    {pageIndex === 0 ? <>
      <section className="receipt-print-section"><h2 className="receipt-print-title">Received From</h2><div className="receipt-print-grid"><div className="receipt-print-card"><strong>{row.customer_name_snapshot || "—"}</strong>{row.customer_company_snapshot && <div>{row.customer_company_snapshot}</div>}{row.customer_registration_no_snapshot && <div>Reg. No. {row.customer_registration_no_snapshot}</div>}</div>{row.customer_email_snapshot && <div className="receipt-print-card"><strong>Contact</strong><div>{row.customer_email_snapshot}</div></div>}</div></section>
      <section className="receipt-print-section"><h2 className="receipt-print-title">Payment For</h2><div className="receipt-print-card"><strong>Invoice Ref. {row.invoice_number_snapshot}</strong><div>Receipt confirmation for payment received against this invoice.</div></div></section>
      <div className="receipt-print-amount"><div className="receipt-print-amount-label">Amount Received</div><div className="receipt-print-amount-value">{fmt(row.amount_received, row.currency)}</div></div>
      <section className="receipt-print-section"><h2 className="receipt-print-title">Payment Details</h2><div className="receipt-print-grid"><div className="receipt-print-card"><span className="receipt-print-detail-label">Payment Method</span><span className="receipt-print-detail-value">{paymentMethodLabel(providerLabel, row.payment_method_snapshot)}</span></div><div className="receipt-print-card"><span className="receipt-print-detail-label">Payment Date</span><span className="receipt-print-detail-value">{fmtDate(row.receipt_date)}</span></div><div className="receipt-print-card"><span className="receipt-print-detail-label">Payment Reference</span><span className="receipt-print-detail-value receipt-print-value">{row.payment_reference_snapshot || "—"}</span></div>{row.provider_reference_snapshot && <div className="receipt-print-card"><span className="receipt-print-detail-label">Provider Reference</span><span className="receipt-print-detail-value receipt-print-value">{row.provider_reference_snapshot}</span></div>}</div></section>
      <section className="receipt-print-section"><h2 className="receipt-print-title">Payment Summary</h2><table className="receipt-print-summary"><tbody><tr><td>Invoice Total</td><td>{fmt(row.invoice_grand_total_snapshot, row.currency)}</td></tr><tr><td>Total Paid To Date</td><td>{fmt(row.amount_paid_after_snapshot, row.currency)}</td></tr><tr className="receipt-print-balance"><td>Balance Remaining</td><td>{fmt(row.balance_after_snapshot, row.currency)}</td></tr></tbody></table>{row.balance_after_snapshot === 0 && <div style={{ marginTop: 10, color: "#0B3A63", fontWeight: 800, textAlign: "right" }}>PAID IN FULL</div>}</section>
    </> : <section className="receipt-print-section"><h2 className="receipt-print-title">{pageIndex === 1 && !notesFitFirstPage ? "Notes" : "Notes — Continued"}</h2><div className="receipt-print-card receipt-print-value">{displayNotePages[pageIndex].join("\n")}</div></section>}
    {pageIndex === 0 && notesFitFirstPage && displayNotePages[0]?.length > 0 && <section className="receipt-print-section"><h2 className="receipt-print-title">Notes</h2><div className="receipt-print-card receipt-print-value">{displayNotePages[0].join("\n")}</div></section>}
    <DocumentFooter documentNumber={row.receipt_no} customerName={row.customer_company_snapshot} pageNumber={pageIndex + 1} pageCount={pageCount} />
  </main>)}</div>;
}
