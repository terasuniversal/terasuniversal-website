import Image from "next/image";
import { notFound } from "next/navigation";
import { requireModuleAccess, requireRole } from "../../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { PRINT_WHEN_READY_SCRIPT } from "../../../../lib/print-when-ready";
import { formatMalaysiaDate } from "../../../../lib/date-time";
import { revisionLabel, type SalesQuotationItemRow, type SalesQuotationRow } from "../../../../lib/sales/crm";

export const metadata = { title: "Quotation - TERAS UNIVERSAL", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const REG_NO = "201201003207 (976732-P)";
const OFFICE_ADDRESS = "Lot 1961, Jalan Tanah Merah, Kg. Tanah Merah Dalam, 06000 Jitra, Kedah.";
const NAVY = "#0B3A63";
const GOLD = "#D4AF37";
const MUTED = "#667085";
const BORDER = "#D9E1EA";
const SANS = "Arial, Helvetica, sans-serif";
type PackageEntry = { key?: unknown; label?: unknown };

function fmt(value: number, currency = "MYR") {
  const prefix = currency === "MYR" ? "RM " : `${currency} `;
  return `${prefix}${Number(value || 0).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function packageEntries(value: unknown): PackageEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is PackageEntry => Boolean(entry && typeof entry === "object" && typeof (entry as PackageEntry).label === "string"));
}
function valueOrDash(value: string | null | undefined) { return value?.trim() || "-"; }

export default async function QuotationPdfPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("editor");
  await requireModuleAccess("sales_quotations");
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: quotation } = await supabase.from("sales_quotations").select("*").eq("id", id).maybeSingle();
  if (!quotation) notFound();
  const q = quotation as SalesQuotationRow;
  const { data: opportunity } = await supabase.from("sales_opportunities").select("opportunity_no, company_name, contact_person, contact_email, contact_phone, company_id").eq("id", q.opportunity_id).maybeSingle();
  const { data: company } = opportunity?.company_id
    ? await supabase.from("companies").select("company_name, registration_no, email, phone, person_in_charge, pic_email, pic_phone, billing_address, address").eq("id", opportunity.company_id).maybeSingle()
    : { data: null };
  const { data: itemRows } = await supabase.from("sales_quotation_items").select("*").eq("quotation_id", id).order("sort_order");
  const items = (itemRows ?? []) as SalesQuotationItemRow[];
  const customer = {
    company: q.customer_company_name ?? company?.company_name ?? opportunity?.company_name,
    contact: q.customer_contact_name ?? company?.person_in_charge ?? opportunity?.contact_person,
    registration: q.customer_registration_no ?? company?.registration_no,
    email: q.customer_email ?? company?.email ?? company?.pic_email ?? opportunity?.contact_email,
    phone: q.customer_phone ?? company?.phone ?? company?.pic_phone ?? opportunity?.contact_phone,
    billing: q.billing_address ?? company?.billing_address ?? company?.address,
    training: q.training_service_address,
  };
  return <div className="quotation-print-root">
    <style>{`
      .quotation-print-root{min-height:100vh;padding:24px;background:#EEF2F6;color:#1D2939;font-family:${SANS};font-size:12px}
      .quotation-print-paper{width:794px;min-height:1123px;box-sizing:border-box;margin:0 auto;padding:44px 52px 34px;background:#fff;box-shadow:0 8px 28px rgba(11,58,99,.12)}
      .quotation-print-header{display:flex;justify-content:space-between;gap:28px;padding-bottom:18px;border-bottom:3px solid ${NAVY}}
      .quotation-print-logo{width:166px;height:auto;object-fit:contain;object-position:left center}
      .quotation-print-company{margin-top:8px;color:${NAVY};font-size:17px;font-weight:800;letter-spacing:.2px}
      .quotation-print-reg{margin-top:4px;color:${MUTED};font-size:10px}.quotation-print-office{max-width:290px;margin-top:5px;color:${MUTED};font-size:10px;line-height:1.45}
      .quotation-print-title{color:${NAVY};font-size:25px;font-weight:800;letter-spacing:2px;text-align:right}
      .quotation-print-meta{display:grid;grid-template-columns:1fr auto;gap:5px 22px;margin-top:10px;color:${MUTED};font-size:11px;text-align:right}.quotation-print-meta strong{color:#1D2939;font-weight:700}
      .quotation-print-section{margin-top:24px}.quotation-print-section-title{margin:0 0 9px;color:${NAVY};font-size:10px;font-weight:800;letter-spacing:1.1px;text-transform:uppercase}
      .quotation-print-card-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.quotation-print-card{min-height:70px;padding:12px 14px;box-sizing:border-box;border:1px solid ${BORDER};border-radius:4px}
      .quotation-print-card-label{margin-bottom:5px;color:${MUTED};font-size:10px;font-weight:700;text-transform:uppercase}.quotation-print-card-value{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.45}.quotation-print-card-value strong{color:${NAVY}}
      .quotation-print-items{width:100%;border-collapse:collapse;table-layout:fixed}.quotation-print-items th{padding:8px 7px;background:${NAVY};color:#fff;font-size:10px;letter-spacing:.3px;text-align:left}.quotation-print-items td{padding:10px 7px;border-bottom:1px solid ${BORDER};vertical-align:top;line-height:1.45}.quotation-print-items tr{break-inside:avoid;page-break-inside:avoid}
      .quotation-print-items th:nth-child(1),.quotation-print-items td:nth-child(1){width:4%;text-align:center}.quotation-print-items th:nth-child(2),.quotation-print-items td:nth-child(2){width:42%}.quotation-print-items th:nth-child(3),.quotation-print-items td:nth-child(3){width:8%;text-align:center}.quotation-print-items th:nth-child(4),.quotation-print-items td:nth-child(4){width:12%;text-align:center}.quotation-print-items th:nth-child(5),.quotation-print-items td:nth-child(5),.quotation-print-items th:nth-child(6),.quotation-print-items td:nth-child(6),.quotation-print-items th:nth-child(7),.quotation-print-items td:nth-child(7){width:14%;text-align:right}
      .quotation-print-course{margin-bottom:5px;color:${NAVY};font-size:12px;font-weight:800}.quotation-print-hrdf{color:${GOLD};font-size:9px;font-weight:800;letter-spacing:.5px}.quotation-print-description{white-space:pre-wrap;overflow-wrap:anywhere}.quotation-print-package{margin-top:7px;color:${MUTED};font-size:10px}.quotation-print-package span:not(:last-child)::after{content:"  |  ";color:${GOLD}}
      .quotation-print-totals-wrap{display:flex;justify-content:flex-end;margin-top:18px;break-inside:avoid;page-break-inside:avoid}.quotation-print-totals{width:270px;border-collapse:collapse;font-size:11px}.quotation-print-totals td{padding:5px 0}.quotation-print-totals td:last-child{text-align:right}.quotation-print-grand td{padding-top:9px;border-top:2px solid ${NAVY};color:${NAVY};font-size:14px;font-weight:800}
      .quotation-print-terms{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.5}.quotation-print-footer{margin-top:28px;padding-top:12px;border-top:1px solid ${BORDER};color:${MUTED};font-size:10px;line-height:1.45}
      @page{size:A4 portrait;margin:0}@media print{.quotation-print-root{width:210mm;min-height:0;padding:0;background:#fff;font-size:10px}.quotation-print-paper{zoom:.7;width:142.857%;min-height:424.286mm;margin:0;padding:10mm 12mm 8mm;box-shadow:none}.quotation-print-logo{width:135px}.quotation-print-company{font-size:15px}.quotation-print-title{font-size:21px}.quotation-print-section{margin-top:12px}.quotation-print-card{min-height:0;padding:7px 9px}.quotation-print-section-title{margin-bottom:6px}.quotation-print-items-section{break-inside:avoid;page-break-inside:avoid}.quotation-print-items-section .quotation-print-section-title{break-after:avoid;page-break-after:avoid}.quotation-print-items th{padding:5px 5px}.quotation-print-items td{padding:6px 5px}.quotation-print-package{margin-top:5px}.quotation-print-totals-wrap{margin-top:10px}.quotation-print-totals td{padding:3px 0}.quotation-print-grand td{padding-top:6px}.quotation-print-footer{margin-top:12px;padding-top:8px}.quotation-print-items thead{display:table-header-group}.quotation-print-header,.quotation-print-card,.quotation-print-totals-wrap{break-inside:avoid;page-break-inside:avoid}*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}}
      @media screen and (max-width:840px){.quotation-print-root{padding:10px;overflow-x:auto}.quotation-print-paper{margin:0}}
    `}</style>
    <main className="quotation-print-paper">
      <header className="quotation-print-header"><div><Image className="quotation-print-logo" src="/teras-universal-logo.png" alt="TERAS Universal" width={600} height={424} priority /><div className="quotation-print-company">TERAS UNIVERSAL SDN. BHD.</div><div className="quotation-print-reg">Company Registration No. {REG_NO}</div><div className="quotation-print-office">{OFFICE_ADDRESS}</div></div><div><div className="quotation-print-title">QUOTATION</div><div className="quotation-print-meta"><span>Quotation No.</span><strong>{q.quotation_no}</strong><span>Revision</span><strong>{revisionLabel(q.revision_no)}</strong><span>Issue Date</span><strong>{formatMalaysiaDate(q.issue_date)}</strong><span>Valid Until</span><strong>{q.valid_until ? formatMalaysiaDate(q.valid_until) : "No expiry"}</strong></div></div></header>
      <section className="quotation-print-section"><h2 className="quotation-print-section-title">Customer</h2><div className="quotation-print-card-grid"><div className="quotation-print-card"><div className="quotation-print-card-label">Customer / Company</div><div className="quotation-print-card-value"><strong>{valueOrDash(customer.company)}</strong></div></div><div className="quotation-print-card"><div className="quotation-print-card-label">Attention</div><div className="quotation-print-card-value">{valueOrDash(customer.contact)}</div></div><div className="quotation-print-card"><div className="quotation-print-card-label">Registration No.</div><div className="quotation-print-card-value">{valueOrDash(customer.registration)}</div></div><div className="quotation-print-card"><div className="quotation-print-card-label">Contact</div><div className="quotation-print-card-value">{valueOrDash(customer.email)}{customer.phone ? `\n${customer.phone}` : ""}</div></div></div></section>
      <section className="quotation-print-section"><h2 className="quotation-print-section-title">Addresses</h2><div className="quotation-print-card-grid"><div className="quotation-print-card"><div className="quotation-print-card-label">Billing Address</div><div className="quotation-print-card-value">{valueOrDash(customer.billing)}</div></div>{customer.training && <div className="quotation-print-card"><div className="quotation-print-card-label">Training / Service Address</div><div className="quotation-print-card-value">{customer.training}</div></div>}</div></section>
      <section className="quotation-print-section quotation-print-items-section"><h2 className="quotation-print-section-title">Programme / Items</h2><table className="quotation-print-items"><thead><tr><th>No.</th><th>Course / Description / Package Includes</th><th>Qty</th><th>Unit</th><th>Unit Price</th><th>Discount</th><th>Amount</th></tr></thead><tbody>{items.map((item,index)=>{const packages=packageEntries(item.package_includes_snapshot);return <tr key={item.id}><td>{index+1}</td><td>{item.course_name_snapshot&&<div className="quotation-print-course">{item.course_name_snapshot}{item.hrdf_claim?<span className="quotation-print-hrdf">  HRDF</span>:null}</div>}<div className="quotation-print-description">{item.description}</div>{packages.length>0&&<div className="quotation-print-package"><strong>Package Includes: </strong>{packages.map((entry,packageIndex)=><span key={`${String(entry.key)}-${packageIndex}`}>{String(entry.label)}</span>)}</div>}</td><td>{item.quantity}</td><td>{item.unit}</td><td>{fmt(item.unit_price,q.currency)}</td><td>{fmt(item.discount,q.currency)}</td><td>{fmt(item.line_total,q.currency)}</td></tr>})}</tbody></table></section>
      <div className="quotation-print-totals-wrap"><table className="quotation-print-totals"><tbody><tr><td>Subtotal</td><td>{fmt(q.subtotal,q.currency)}</td></tr><tr><td>Discount</td><td>{fmt(q.discount,q.currency)}</td></tr><tr><td>{q.sst_applicable?`SST (${q.sst_rate}%)`:"Tax (not applicable)"}</td><td>{fmt(q.tax,q.currency)}</td></tr><tr className="quotation-print-grand"><td>Grand Total</td><td>{fmt(q.total,q.currency)}</td></tr></tbody></table></div>
      {(q.terms||q.notes)&&<section className="quotation-print-section"><h2 className="quotation-print-section-title">Terms / Notes</h2>{q.terms&&<div className="quotation-print-terms"><strong>Terms</strong><br />{q.terms}</div>}{q.notes&&<div className="quotation-print-terms" style={{marginTop:10}}><strong>Notes</strong><br />{q.notes}</div>}</section>}
      <footer className="quotation-print-footer">Thank you for the opportunity to serve you. Please refer to the quotation number in all correspondence with TERAS UNIVERSAL SDN. BHD.</footer>
    </main><script dangerouslySetInnerHTML={{__html:PRINT_WHEN_READY_SCRIPT}} />
  </div>;
}
