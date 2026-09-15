import Link from "next/link";
import { notFound } from "next/navigation";
import { brand, companyProfile } from "../../../../../../data/companyProfile";
import { requireModuleAccess, requireRole } from "../../../../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import {
  QUOTATION_STATUS_LABELS,
  revisionLabel,
  type SalesOpportunityRow,
  type SalesQuotationItemRow,
  type SalesQuotationRow,
} from "../../../../../../lib/sales/crm";
import { PrintButton } from "./PrintButton";

export const metadata = {
  title: "Quotation Preview — TERAS UNIVERSAL",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

const SANS = "'Helvetica Neue', Helvetica, Arial, sans-serif";

function formatMoney(value: number, currency: string) {
  const prefix = currency === "MYR" ? "RM" : currency;
  return `${prefix} ${Number(value).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Staff-only quotation document preview. This route intentionally sits outside
 * the protected Sales layout so the CRM navigation cannot appear in the
 * printed document. Authentication and module access are still enforced here.
 */
export default async function SalesQuotationPdfPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("editor");
  await requireModuleAccess("sales_quotations");
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: quotation } = await supabase.from("sales_quotations").select("*").eq("id", id).maybeSingle();
  if (!quotation) notFound();
  const q = quotation as SalesQuotationRow;

  const [{ data: opportunityRow }, { data: itemRows }, { data: preparedByRow }] = await Promise.all([
    supabase.from("sales_opportunities").select("*").eq("id", q.opportunity_id).maybeSingle(),
    supabase.from("sales_quotation_items").select("*").eq("quotation_id", id).order("sort_order", { ascending: true }),
    q.created_by ? supabase.from("profiles").select("full_name").eq("id", q.created_by).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  const opportunity = opportunityRow as SalesOpportunityRow | null;
  const items = (itemRows ?? []) as SalesQuotationItemRow[];
  const statusLabel = QUOTATION_STATUS_LABELS[q.status] ?? q.status;
  const creatorName = (preparedByRow as { full_name: string | null } | null)?.full_name?.trim();
  const preparedBy = creatorName || "TERAS UNIVERSAL Sales Team";

  return (
    <main className="quote-preview-shell">
      <style>{`
        :root { color-scheme: light; }
        .quote-preview-shell {
          min-height: 100vh;
          padding: 24px;
          background: #eef1f6;
          color: #172033;
          font-family: ${SANS};
        }
        .quote-preview-actions {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          max-width: 794px;
          margin: 0 auto 16px;
        }
        .quote-preview-actions a,
        .quote-print-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 38px;
          padding: 8px 14px;
          border: 1px solid #0b3a63;
          border-radius: 7px;
          background: #0b3a63;
          color: #fff;
          font: inherit;
          font-size: 13px;
          font-weight: 700;
          text-decoration: none;
          cursor: pointer;
        }
        .quote-preview-actions a { background: #fff; color: #0b3a63; }
        .quote-document {
          width: 100%;
          max-width: 794px;
          min-height: 1123px;
          box-sizing: border-box;
          margin: 0 auto;
          padding: 52px 58px;
          background: #fff;
          box-shadow: 0 2px 12px rgba(16, 24, 40, .12);
        }
        .quote-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 24px;
          padding-bottom: 18px;
          border-bottom: 3px solid #0b3a63;
        }
        .quote-brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
        .quote-brand img { width: 58px; height: 58px; object-fit: contain; }
        .quote-company-name { color: #0b3a63; font-size: 18px; font-weight: 800; }
        .quote-company-contact { margin-top: 5px; color: #667085; font-size: 10.5px; line-height: 1.5; }
        .quote-title { color: #0b3a63; font-size: 25px; font-weight: 800; letter-spacing: .04em; text-align: right; }
        .quote-number { margin-top: 5px; font-size: 12px; text-align: right; }
        .quote-status { display: inline-block; margin-top: 8px; padding: 4px 8px; border: 1px solid #b7c8d8; color: #0b3a63; font-size: 10px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; }
        .quote-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin: 26px 0; font-size: 12px; line-height: 1.6; }
        .quote-label { margin-bottom: 4px; color: #667085; font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
        .quote-customer-name { font-size: 14px; font-weight: 800; }
        .quote-meta-right { text-align: right; }
        .quote-table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 11.5px; }
        .quote-table th { padding: 9px 6px; background: #f3f5f9; color: #344054; font-size: 10px; text-align: left; text-transform: uppercase; }
        .quote-table td { padding: 10px 6px; border-bottom: 1px solid #e4e7ec; vertical-align: top; }
        .quote-table .number { text-align: right; white-space: nowrap; }
        .quote-table tr { break-inside: avoid; page-break-inside: avoid; }
        .quote-totals { display: flex; justify-content: flex-end; margin-top: 18px; }
        .quote-totals table { width: 270px; border-collapse: collapse; font-size: 12px; }
        .quote-totals td { padding: 4px 0; }
        .quote-totals td:last-child { text-align: right; white-space: nowrap; }
        .quote-grand-total td { padding-top: 8px; border-top: 2px solid #0b3a63; color: #0b3a63; font-size: 14px; font-weight: 800; }
        .quote-notes { margin-top: 28px; font-size: 11.5px; line-height: 1.55; }
        .quote-notes h2 { margin: 0 0 5px; color: #0b3a63; font-size: 12px; }
        .quote-notes p { margin: 0; white-space: pre-wrap; }
        .quote-footer { margin-top: 44px; padding-top: 12px; border-top: 1px solid #d0d5dd; color: #667085; font-size: 10px; line-height: 1.5; }
        @page { size: A4 portrait; margin: 0; }
        @media print {
          html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
          .quote-preview-shell { min-height: 0; padding: 0; background: #fff; }
          .quote-preview-actions { display: none !important; }
          .quote-document { max-width: none; min-height: 0; margin: 0; padding: 50px 58px; box-shadow: none; }
          .quote-header, .quote-totals, .quote-notes, .quote-footer { break-inside: avoid; page-break-inside: avoid; }
          .quote-table th:nth-child(4), .quote-table td:nth-child(4) { display: table-cell !important; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
        @media (max-width: 640px) {
          .quote-preview-shell { padding: 12px; }
          .quote-preview-actions { align-items: stretch; flex-direction: column-reverse; }
          .quote-preview-actions a, .quote-print-button { width: 100%; }
          .quote-document { min-height: 0; padding: 28px 20px; }
          .quote-header { flex-direction: column; }
          .quote-title, .quote-number { text-align: left; }
          .quote-meta { grid-template-columns: 1fr; gap: 14px; }
          .quote-meta-right { text-align: left; }
          .quote-table { font-size: 10px; }
          .quote-table th, .quote-table td { padding: 7px 4px; }
          .quote-table th:nth-child(4), .quote-table td:nth-child(4) { display: none; }
          .quote-totals table { width: 100%; }
        }
      `}</style>

      <div className="quote-preview-actions">
        <Link href={`/admin/sales/quotations/${id}`}>Back to quotation</Link>
        <PrintButton />
      </div>

      <article className="quote-document">
        <header className="quote-header">
          <div className="quote-brand">
            <img src="/teras-universal-logo.png" alt="TERAS UNIVERSAL" />
            <div>
              <div className="quote-company-name">{companyProfile.name}</div>
              <div className="quote-company-contact">
                {companyProfile.contact.address}<br />
                {companyProfile.contact.email} · {companyProfile.contact.phone}
              </div>
            </div>
          </div>
          <div>
            <div className="quote-title">QUOTATION</div>
            <div className="quote-number">{q.quotation_no} · {revisionLabel(q.revision_no)}</div>
            <div className="quote-status">{statusLabel}</div>
          </div>
        </header>

        <section className="quote-meta" aria-label="Quotation information">
          <div>
            <div className="quote-label">Customer</div>
            <div className="quote-customer-name">{opportunity?.company_name ?? "—"}</div>
            {opportunity?.contact_person && <div>{opportunity.contact_person}</div>}
            {opportunity?.contact_email && <div>{opportunity.contact_email}</div>}
            {opportunity?.contact_phone && <div>{opportunity.contact_phone}</div>}
          </div>
          <div className="quote-meta-right">
            <div><span className="quote-label">Quotation date</span><br />{formatDate(q.issue_date)}</div>
            <div><span className="quote-label">Valid until</span><br />{formatDate(q.valid_until)}</div>
            {opportunity?.programme && <div><span className="quote-label">Programme</span><br />{opportunity.programme}</div>}
          </div>
        </section>

        <table className="quote-table">
          <thead>
            <tr><th>Description</th><th className="number">Quantity</th><th>Unit</th><th className="number">Unit Price</th><th className="number">Amount</th></tr>
          </thead>
          <tbody>
            {items.length > 0 ? items.map((item) => (
              <tr key={item.id}>
                <td>{item.description}</td>
                <td className="number">{item.quantity}</td>
                <td>{item.unit}</td>
                <td className="number">{formatMoney(item.unit_price, q.currency)}</td>
                <td className="number">{formatMoney(item.line_total, q.currency)}</td>
              </tr>
            )) : (
              <tr><td colSpan={5}>No line items recorded.</td></tr>
            )}
          </tbody>
        </table>

        <div className="quote-totals">
          <table>
            <tbody>
              <tr><td>Subtotal</td><td>{formatMoney(q.subtotal, q.currency)}</td></tr>
              <tr><td>Discount</td><td>− {formatMoney(q.discount, q.currency)}</td></tr>
              <tr><td>{q.sst_applicable ? `SST (${q.sst_rate}%)` : "Tax (not applicable)"}</td><td>{formatMoney(q.tax, q.currency)}</td></tr>
              <tr className="quote-grand-total"><td>Grand total</td><td>{formatMoney(q.total, q.currency)}</td></tr>
            </tbody>
          </table>
        </div>

        {q.notes && <section className="quote-notes"><h2>Notes</h2><p>{q.notes}</p></section>}
        {q.terms && <section className="quote-notes"><h2>Terms</h2><p>{q.terms}</p></section>}

        <footer className="quote-footer">
          <div>Prepared by: {preparedBy}</div>
          <div>{brand.tagline}</div>
          <div>This document reflects quotation revision {revisionLabel(q.revision_no)} and status: {statusLabel}.</div>
        </footer>
      </article>
    </main>
  );
}
