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

type CompanyAddressRow = {
  registration_no: string | null;
  address: string | null;
  billing_address: string | null;
  postcode: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
};

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
  const { data: companyRow } = opportunity?.company_id
    ? await supabase
        .from("companies")
        .select("registration_no, address, billing_address, postcode, city, state, country")
        .eq("id", opportunity.company_id)
        .maybeSingle()
    : { data: null };
  const items = (itemRows ?? []) as SalesQuotationItemRow[];
  const statusLabel = QUOTATION_STATUS_LABELS[q.status] ?? q.status;
  const creatorName = (preparedByRow as { full_name: string | null } | null)?.full_name?.trim();
  const preparedBy = creatorName || "TERAS UNIVERSAL Sales Team";
  const company = companyRow as CompanyAddressRow | null;
  const billingAddress = company?.billing_address?.trim() && company.billing_address.trim() !== "-"
    ? company.billing_address.trim()
    : null;
  const addressParts = [
    ...(billingAddress ? [billingAddress] : company?.address?.trim() && company.address.trim() !== "-" ? [company.address.trim()] : []),
    [company?.postcode, company?.city].filter((part) => part?.trim()).join(" "),
    [company?.state, company?.country].filter((part) => part?.trim()).join(", "),
  ].filter(Boolean);
  const registrationNo = company?.registration_no?.trim() && company.registration_no.trim() !== "-"
    ? company.registration_no.trim()
    : null;

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
          box-sizing: border-box;
          margin: 0 auto;
          padding: 42px 52px;
          background: #fff;
          box-shadow: 0 2px 12px rgba(16, 24, 40, .12);
        }
        .quote-document > section { padding: 0; }
        .quote-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 32px;
          padding-bottom: 18px;
          border-bottom: 4px solid #0b2c56;
        }
        .quote-brand { display: flex; align-items: center; gap: 14px; min-width: 0; }
        .quote-brand img { width: 78px; height: 78px; object-fit: contain; }
        .quote-company-name { color: #0b2c56; font-size: 19px; font-weight: 800; letter-spacing: .01em; }
        .quote-company-contact { margin-top: 6px; color: #475467; font-size: 10.5px; line-height: 1.55; }
        .quote-header-meta { min-width: 220px; text-align: right; }
        .quote-title { color: #0b2c56; font-size: 26px; font-weight: 800; letter-spacing: .06em; text-align: right; }
        .quote-document-meta { display: grid; grid-template-columns: auto auto; gap: 3px 12px; margin: 10px 0 0; font-size: 10.5px; line-height: 1.45; }
        .quote-document-meta dt { color: #667085; font-size: 9px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
        .quote-document-meta dd { margin: 0; font-weight: 700; }
        .quote-status { display: inline-block; margin-top: 10px; padding: 4px 9px; background: #0b2c56; color: #fff; font-size: 9px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
        .quote-section-label { margin-bottom: 6px; color: #667085; font-size: 9px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
        .quote-meta { display: grid; grid-template-columns: 1.15fr .85fr; gap: 12px; margin: 18px 0 14px; font-size: 11.5px; line-height: 1.5; }
        .quote-info-card { padding: 12px 14px; border: 1px solid #d0d5dd; background: #fbfcfe; }
        .quote-label { margin-bottom: 3px; color: #667085; font-size: 9px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
        .quote-customer-name { color: #172033; font-size: 14px; font-weight: 800; }
        .quote-address { margin-top: 9px; color: #475467; line-height: 1.4; }
        .quote-address .quote-label { margin-bottom: 2px; }
        .quote-meta-right { text-align: left; }
        .quote-meta-right .quote-label { display: inline-block; min-width: 86px; margin-right: 5px; }
        .quote-document > .quote-programme { display: block; align-self: start; height: auto; min-height: 0; margin: 0 0 10px; padding: 4px 10px; border-left: 3px solid #e1a925; background: #f8fafc; }
        .quote-programme .quote-section-label { margin-bottom: 2px; }
        .quote-programme-value { color: #172033; font-size: 12.5px; font-weight: 700; line-height: 1.25; }
        .quote-table { width: 100%; border-collapse: collapse; margin-top: 0; font-size: 11.5px; }
        .quote-table th { padding: 9px 7px; background: #0b2c56; color: #fff; font-size: 9.5px; text-align: left; text-transform: uppercase; }
        .quote-table td { padding: 8px 6px; border-bottom: 1px solid #e4e7ec; vertical-align: top; }
        .quote-table .number { text-align: right; white-space: nowrap; }
        .quote-table tr { break-inside: avoid; page-break-inside: avoid; }
        .quote-totals { display: flex; justify-content: flex-end; margin-top: 14px; }
        .quote-totals table { width: 270px; border-collapse: collapse; font-size: 12px; }
        .quote-totals td { padding: 4px 0; }
        .quote-totals td:last-child { text-align: right; white-space: nowrap; }
        .quote-grand-total td { padding-top: 8px; border-top: 2px solid #0b3a63; color: #0b3a63; font-size: 14px; font-weight: 800; }
        .quote-notes { margin-top: 12px; font-size: 11.5px; line-height: 1.55; }
        .quote-notes + .quote-notes { margin-top: 10px; }
        .quote-notes h2 { margin: 0 0 5px; color: #0b3a63; font-size: 12px; }
        .quote-notes p { margin: 0; white-space: pre-wrap; }
        .quote-closing { margin-top: 18px; color: #172033; font-size: 11px; font-weight: 700; }
        .quote-footer { margin-top: 10px; padding: 12px 16px; background: #0b2c56; color: #f8fafc; font-size: 10.5px; line-height: 1.55; }
        @page { size: A4 portrait; margin: 0; }
        @media print {
          html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
          .quote-preview-shell { min-height: 0; padding: 0; background: #fff; }
          .quote-preview-actions { display: none !important; }
          .quote-document { max-width: none; margin: 0; padding: 38px 52px; box-shadow: none; }
          .quote-table thead { display: table-header-group; }
          .quote-header, .quote-meta, .quote-programme, .quote-totals, .quote-notes, .quote-closing, .quote-footer { break-inside: avoid; page-break-inside: avoid; }
          .quote-programme { display: block; height: auto !important; min-height: 0 !important; }
          .quote-footer { background: #0b2c56 !important; color: #f8fafc !important; }
          .quote-table th:nth-child(4), .quote-table td:nth-child(4) { display: table-cell !important; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
        @media (max-width: 640px) {
          .quote-preview-shell { padding: 12px; }
          .quote-preview-actions { align-items: stretch; flex-direction: column-reverse; }
          .quote-preview-actions a, .quote-print-button { width: 100%; }
          .quote-document { padding: 24px 20px; }
          .quote-header { flex-direction: column; }
          .quote-header-meta { width: 100%; text-align: left; }
          .quote-title { text-align: left; }
          .quote-document-meta { grid-template-columns: auto auto; }
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
          <div className="quote-header-meta">
            <div className="quote-title">QUOTATION</div>
            <dl className="quote-document-meta">
              <dt>Quotation No.</dt><dd>{q.quotation_no}</dd>
              <dt>Revision</dt><dd>{revisionLabel(q.revision_no)}</dd>
              <dt>Issue Date</dt><dd>{formatDate(q.issue_date)}</dd>
              <dt>Valid Until</dt><dd>{formatDate(q.valid_until)}</dd>
            </dl>
            <div className="quote-status">{statusLabel}</div>
          </div>
        </header>

        <section className="quote-meta" aria-label="Quotation information">
          <div className="quote-info-card">
            <div className="quote-section-label">Customer</div>
            <div className="quote-customer-name">{opportunity?.company_name ?? "—"}</div>
            {registrationNo && <div><span className="quote-label">Registration No.</span> {registrationNo}</div>}
            {addressParts.length > 0 && (
              <div className="quote-address">
                <div className="quote-label">Address</div>
                <div>{addressParts.map((part, index) => <span key={`${part}-${index}`}>{index > 0 && <br />}{part}</span>)}</div>
              </div>
            )}
          </div>
          <div className="quote-info-card quote-meta-right">
            <div className="quote-section-label">Attention</div>
            <div className="quote-customer-name">{opportunity?.contact_person ?? "—"}</div>
            {opportunity?.contact_email && <div><span className="quote-label">Email</span> {opportunity.contact_email}</div>}
            {opportunity?.contact_phone && <div><span className="quote-label">Phone</span> {opportunity.contact_phone}</div>}
          </div>
        </section>

        {opportunity?.programme && (
          <section className="quote-programme" aria-label="Programme">
            <div className="quote-section-label">Programme</div>
            <div className="quote-programme-value">{opportunity.programme}</div>
          </section>
        )}

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

        <div className="quote-closing">Prepared by: {preparedBy}</div>
        <footer className="quote-footer">
          <div>{brand.tagline}</div>
          <div>This document reflects quotation revision {revisionLabel(q.revision_no)} and status: {statusLabel}.</div>
        </footer>
      </article>
    </main>
  );
}
