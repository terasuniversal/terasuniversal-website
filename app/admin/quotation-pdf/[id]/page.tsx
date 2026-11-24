import { notFound } from "next/navigation";
import { requireModuleAccess, requireRole } from "../../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { DocumentPrintController } from "../../../../components/admin/documents/DocumentPrintController";
import { formatMalaysiaDate } from "../../../../lib/date-time";
import { revisionLabel, type SalesQuotationItemRow, type SalesQuotationRow } from "../../../../lib/sales/crm";
import { parseQuotationTrainingDetails } from "../../../../lib/documents/quotation-training-details";
import { DocumentFooter, DocumentHeader } from "../../../../components/admin/documents/DocumentHeader";
import { quotationTermsText } from "../../../../lib/documents/company";
import { layoutQuotationPages, type QuotationBlock, type QuotationCard, type QuotationInfoSection, type QuotationRow } from "../../../../lib/documents/quotation-layout";
import { PRINT_GEOMETRY_ATTRIBUTE, scopePrintGeometry } from "../../../../lib/documents/print-geometry";

export const metadata = { title: "Quotation - TERAS UNIVERSAL", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const NAVY = "#0B3A63";
const GOLD = "#D4AF37";
const MUTED = "#667085";
const BORDER = "#D9E1EA";
const SANS = "Montserrat, Poppins, Inter, Arial, Helvetica, sans-serif";
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

function QuotationReadFailure() {
  return <main role="alert" style={{ maxWidth: 620, margin: "64px auto", padding: 24, border: `1px solid ${BORDER}`, color: "#1D2939", fontFamily: SANS }}>
    <h1 style={{ color: NAVY }}>Quotation unavailable</h1>
    <p>We could not verify all quotation data. This quotation was not generated, and no totals or printable quotation are available.</p>
    <p>Please refresh and try again. If the problem continues, contact a system administrator.</p>
  </main>;
}

export default async function QuotationPdfPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("editor");
  await requireModuleAccess("sales_quotations");
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: quotation, error: quotationError } = await supabase.from("sales_quotations").select("*").eq("id", id).maybeSingle();
  if (quotationError) return <QuotationReadFailure />;
  if (!quotation) notFound();
  const q = quotation as SalesQuotationRow;
  const training = parseQuotationTrainingDetails((q as unknown as { training_details?: unknown }).training_details);
  const { data: opportunity, error: opportunityError } = await supabase.from("sales_opportunities").select("opportunity_no, company_name, contact_person, contact_email, contact_phone, company_id").eq("id", q.opportunity_id).maybeSingle();
  if (opportunityError) return <QuotationReadFailure />;
  const { data: company, error: companyError } = opportunity?.company_id
    ? await supabase.from("companies").select("company_name, registration_no, email, phone, person_in_charge, pic_email, pic_phone, billing_address, address").eq("id", opportunity.company_id).maybeSingle()
    : { data: null, error: null };
  if (companyError) return <QuotationReadFailure />;
  const { data: itemRows, error: itemsError } = await supabase.from("sales_quotation_items").select("*").eq("quotation_id", id).order("sort_order");
  if (itemsError) return <QuotationReadFailure />;
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

  const termsText = quotationTermsText(q.terms, q.valid_until, formatMalaysiaDate);
  // DOC-4: the cards below are the single source for the customer/programme sections; they render whole, or flow
  // line by line across papers when a section is taller than a page (lib/documents/quotation-layout.ts).
  const infoSections: QuotationInfoSection[] = [
    { key: "customer", title: "Customer", cards: [
      { label: "Customer / Company", strong: valueOrDash(customer.company) },
      { label: "Attention", text: valueOrDash(customer.contact) },
      { label: "Registration No.", text: valueOrDash(customer.registration) },
      { label: "Contact", text: `${valueOrDash(customer.email)}${customer.phone ? `\n${customer.phone}` : ""}` },
    ] },
    { key: "addresses", title: "Addresses", cards: [
      { label: "Billing Address", text: valueOrDash(customer.billing) },
      ...(customer.training ? [{ label: "Training / Service Address", text: customer.training }] : []),
    ] },
    ...(training ? [
      { key: "programme", title: "Programme Details", cards: [
        { label: "Programme", strong: valueOrDash(training.programme.course_name_snapshot) },
        { label: "Date / Duration", text: `${training.programme.start_date || "—"} → ${training.programme.end_date || "—"}${training.programme.duration_label ? `\n${training.programme.duration_label}` : ""}` },
        { label: "Participants", text: `${training.participants.count} Pax${training.participants.tbc || training.participants.names.length === 0 ? "\nTo Be Confirmed (TBC)" : `\n${training.participants.names.join("\n")}`}` },
        { label: "Venue / Location", strong: training.venue.type === "teras_hq" ? "TERAS HQ" : "In-House", text: `${training.venue.name ? `\n${training.venue.name}` : ""}${training.venue.address ? `\n${training.venue.address}` : ""}` },
      ] },
      { key: "package", title: "Training Package Summary", cards: [
        { label: "Accommodation", text: `${training.accommodation.included ? `Included${training.accommodation.nights ? ` — ${training.accommodation.nights} nights` : ""}` : "Not Included"}${training.accommodation.description ? `\n${training.accommodation.description}` : ""}` },
        { label: "Meals", text: `${training.meals.included ? `Included${training.meals.meals_per_day ? ` — ${training.meals.meals_per_day} per day` : ""}` : "Not Included"}${training.meals.description ? `\n${training.meals.description}` : ""}` },
        { label: "Additional Inclusions", full: true, text: [training.inclusions.training_notes ? "Training notes" : null, training.inclusions.practical_assessment ? "Practical assessment" : null, training.inclusions.certificate ? "Certificate" : null, ...training.inclusions.other].filter(Boolean).join("  |  ") || "-" },
      ] },
    ] : []),
  ];
  const pages = layoutQuotationPages({
    infoSections,
    items: items.map((item) => ({ ...item, packageLabels: packageEntries(item.package_includes_snapshot).map((entry) => String(entry.label)) })),
    termsText: q.terms || q.notes || q.valid_until ? termsText : null,
    notes: q.notes,
    trainingNotes: Boolean(training?.inclusions.training_notes),
  });
  const pageCount = pages.length;
  const identity = [{ label: "Quotation No.", value: q.quotation_no }, { label: "Revision", value: revisionLabel(q.revision_no) }, { label: "Issue Date", value: formatMalaysiaDate(q.issue_date) }, { label: "Valid Until", value: q.valid_until ? formatMalaysiaDate(q.valid_until) : "No expiry" }];

  function renderItems(pageItems: SalesQuotationItemRow[]) {
    return <table className="quotation-print-items"><thead><tr><th>No.</th><th>Course / Description / Package Includes</th><th>Qty</th><th>Unit</th><th>Unit Price</th><th>Discount</th><th>Amount</th></tr></thead><tbody>{pageItems.map((item) => { const originalIndex = items.findIndex((row) => row.id === item.id); const packages = packageEntries(item.package_includes_snapshot); return <tr key={item.id}><td>{originalIndex + 1}</td><td>{item.course_name_snapshot && <div className="quotation-print-course">{item.course_name_snapshot}{item.hrdf_claim ? <span className="quotation-print-hrdf"> HRDF</span> : null}</div>}<div className="quotation-print-description">{item.description}</div>{packages.length > 0 && <div className="quotation-print-package"><strong>Package Includes: </strong>{packages.map((entry, packageIndex) => <span key={`${String(entry.key)}-${packageIndex}`}>{String(entry.label)}</span>)}</div>}</td><td>{item.quantity}</td><td>{item.unit}</td><td>{fmt(item.unit_price, q.currency)}</td><td>{fmt(item.discount, q.currency)}</td><td>{fmt(item.line_total, q.currency)}</td></tr>; })}</tbody></table>;
  }
  function renderCard(card: QuotationCard, index: number) {
    return <div className="quotation-print-card" key={index} style={card.full ? { gridColumn: "1 / -1" } : undefined}><div className="quotation-print-card-label">{card.label}</div><div className="quotation-print-card-value">{card.strong ? <strong>{card.strong}</strong> : null}{card.text}</div></div>;
  }
  function renderRows(rows: QuotationRow[], className: string) {
    return rows.map((row, index) => row.type === "gap" ? <div key={index} className="quotation-print-row-gap" /> : row.type === "label" ? <div key={index} className={`${className} quotation-print-row-label`}>{row.text}</div> : <div key={index} className={className}>{row.type === "strong" ? <strong>{row.text}</strong> : row.text}</div>);
  }
  function renderTermsRows(rows: QuotationRow[]) {
    return rows.map((row, index) => row.type === "gap" ? <div key={index} className="quotation-print-row-gap" /> : <div key={index} className="quotation-print-terms">{row.type === "label" ? <strong>{row.text}</strong> : row.text}</div>);
  }
  function renderBlock(block: QuotationBlock<SalesQuotationItemRow & { packageLabels: string[] }>, index: number) {
    switch (block.kind) {
      case "info": {
        const section = infoSections.find((entry) => entry.key === block.key)!;
        return <section key={index} className="quotation-print-section"><h2 className="quotation-print-section-title">{section.title}</h2><div className="quotation-print-card-grid">{section.cards.map(renderCard)}</div></section>;
      }
      case "infoLines": return <section key={index} className="quotation-print-section"><h2 className="quotation-print-section-title">{block.first ? block.title : `${block.title} — Continued`}</h2><div className="quotation-print-card">{renderRows(block.rows, "quotation-print-card-value")}</div></section>;
      case "items": return <section key={index} className="quotation-print-section quotation-print-items-section"><h2 className="quotation-print-section-title">{block.first ? "Commercial Breakdown" : "Commercial Breakdown — Continued"}</h2>{renderItems(block.items)}</section>;
      case "totals": return <div key={index}><div className="quotation-print-totals-wrap"><table className="quotation-print-totals"><tbody><tr><td>Subtotal</td><td>{fmt(q.subtotal, q.currency)}</td></tr><tr><td>Discount</td><td>{fmt(q.discount, q.currency)}</td></tr><tr><td>{q.sst_applicable ? `SST (${q.sst_rate}%)` : "Tax (not applicable)"}</td><td>{fmt(q.tax, q.currency)}</td></tr><tr className="quotation-print-grand"><td>Grand Total</td><td>{fmt(q.total, q.currency)}</td></tr></tbody></table></div></div>;
      case "termsNotes": return <section key={index} className="quotation-print-section"><h2 className="quotation-print-section-title">{block.first ? "Terms / Notes" : "Terms / Notes — Continued"}</h2>{renderTermsRows(block.rows)}</section>;
      case "trainingNotes": return <div key={index}><section className="quotation-print-section"><h2 className="quotation-print-section-title">Training Notes</h2><div className="quotation-print-terms">Training notes are included as part of the quotation snapshot.</div></section></div>;
    }
  }

  // Print rules live once: applied by @media print, and scoped under html[data-print-geometry] so the print
  // controller can verify every paper fits A4 in the printed geometry before printing (DOC-2/DOC-4).
  const printGeometry = `html,body{margin:0!important;padding:0!important}.quotation-print-root{width:auto;min-height:0;padding:0;background:#fff;font-size:10px}.quotation-print-paper{width:210mm;height:297mm;min-height:297mm;margin:0;padding:10mm 12mm 20mm;box-shadow:none;break-after:page;page-break-after:always}.quotation-print-paper:last-of-type{break-after:auto;page-break-after:auto}.teras-document-logo{width:118px}.teras-document-company{font-size:10px}.quotation-print-section{margin-top:11px;padding-top:6px}.quotation-print-card{min-height:0;padding:7px 9px}.quotation-print-section-title{margin-bottom:6px}.quotation-print-items th{padding:5px}.quotation-print-items td{padding:6px 5px;font-size:10px}.quotation-print-package{margin-top:5px}.quotation-print-totals-wrap{margin-top:8px}.quotation-print-totals td{padding:3px 6px}.quotation-print-grand td{padding-top:6px}.teras-document-header,.quotation-print-card,.quotation-print-totals-wrap{break-inside:avoid;page-break-inside:avoid}*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}.quotation-print-root .quotation-print-section{padding-block:6px 0}`;
  return <div className="quotation-print-root"><style>{`
    @page{size:A4 portrait;margin:0}
    .quotation-print-root{min-height:100vh;padding:24px;background:#EEF2F6;color:#1D2939;font-family:${SANS};font-size:12px}
    .quotation-print-paper{width:794px;min-height:1123px;box-sizing:border-box;margin:0 auto;padding:44px 52px 84px;background:#fff;box-shadow:0 8px 28px rgba(11,58,99,.12);position:relative;break-after:page;page-break-after:always}
    .quotation-print-paper:last-of-type{break-after:auto;page-break-after:auto}
    .teras-document-header{display:flex;justify-content:space-between;gap:28px;padding-bottom:16px;border-bottom:3px solid ${NAVY}}
    .teras-document-brand{min-width:0}.teras-document-logo{width:188px;height:auto;object-fit:contain;object-position:left center}.teras-document-company{margin-top:7px;color:${NAVY};font-size:10px;font-weight:700;letter-spacing:1px}.teras-document-registration{margin-top:4px;color:${MUTED};font-size:10px}.teras-document-address{max-width:290px;margin-top:5px;color:${MUTED};font-size:10px;line-height:1.45}.teras-document-contact{margin-top:3px;color:${MUTED};font-size:9px;line-height:1.35;white-space:nowrap}.teras-document-identity{text-align:right}.teras-document-title{color:${NAVY};font-size:25px;font-weight:800;letter-spacing:2px}.teras-document-meta{display:grid;gap:5px 22px;margin-top:10px;color:${MUTED};font-size:11px;text-align:right}.teras-document-meta-row{display:grid;grid-template-columns:1fr auto;gap:22px}.teras-document-meta-row strong{color:#1D2939;font-weight:700}
    .quotation-print-section{margin-top:21px;padding-top:10px;border-top:1px solid #E8EDF3}.quotation-print-section-title{margin:0 0 8px;color:${NAVY};font-size:10px;font-weight:800;letter-spacing:1.1px;text-transform:uppercase}.quotation-print-section-title::after{content:"";display:block;width:24px;margin-top:4px;border-bottom:2px solid ${GOLD}}
    .quotation-print-card-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.quotation-print-card{min-height:64px;padding:10px 12px;box-sizing:border-box;border:1px solid #E3E9F0;border-radius:2px}.quotation-print-card-label{margin-bottom:5px;color:${MUTED};font-size:10px;font-weight:700;text-transform:uppercase}.quotation-print-card-value{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.45}.quotation-print-card-value strong{color:${NAVY}}
    .quotation-print-items{width:100%;border-collapse:collapse;table-layout:fixed}.quotation-print-items th{padding:8px 7px;background:${NAVY};color:#fff;font-size:10px;letter-spacing:.3px;text-align:left}.quotation-print-items td{padding:8px 7px;border-bottom:1px solid ${BORDER};vertical-align:top;line-height:1.45;font-size:11px}.quotation-print-items tr{break-inside:avoid;page-break-inside:avoid}.quotation-print-items thead{display:table-header-group}
    .quotation-print-items th:nth-child(1),.quotation-print-items td:nth-child(1){width:4%;text-align:center}.quotation-print-items th:nth-child(2),.quotation-print-items td:nth-child(2){width:42%}.quotation-print-items th:nth-child(3),.quotation-print-items td:nth-child(3){width:8%;text-align:center}.quotation-print-items th:nth-child(4),.quotation-print-items td:nth-child(4){width:12%;text-align:center}.quotation-print-items th:nth-child(5),.quotation-print-items td:nth-child(5),.quotation-print-items th:nth-child(6),.quotation-print-items td:nth-child(6),.quotation-print-items th:nth-child(7),.quotation-print-items td:nth-child(7){width:14%;text-align:right}
    .quotation-print-course{margin-bottom:5px;color:${NAVY};font-size:12px;font-weight:800}.quotation-print-hrdf{color:${GOLD};font-size:9px;font-weight:800;letter-spacing:.5px}.quotation-print-description{white-space:pre-wrap;overflow-wrap:anywhere}.quotation-print-package{margin-top:7px;color:${MUTED};font-size:10px}.quotation-print-package span:not(:last-child)::after{content:"  |  ";color:${GOLD}}
    .quotation-print-totals-wrap{display:flex;justify-content:flex-end;margin-top:14px;break-inside:avoid;page-break-inside:avoid}.quotation-print-totals{width:270px;border-collapse:collapse;font-size:11px}.quotation-print-totals td{padding:5px 8px}.quotation-print-totals td:last-child{text-align:right}.quotation-print-grand td{padding-top:8px;border-top:2px solid ${NAVY};border-bottom:2px solid ${GOLD};background:#F5F8FB;color:${NAVY};font-size:14px;font-weight:800}
    .quotation-print-terms{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.5}.teras-document-running-footer{position:absolute;bottom:22px;left:52px;right:52px;padding-top:8px;border-top:1px solid ${BORDER};background:#fff;color:${MUTED};font-size:8px;display:flex;justify-content:space-between;gap:12px;z-index:2}
    .quotation-print-row-gap{height:10px}.quotation-print-row-label{margin-top:4px;color:${MUTED};font-size:10px;font-weight:700;text-transform:uppercase}
    /* CSS-1: app/globals.css "body:has(.teras-admin) section { padding-block: 86px }" (0,1,2) outranks the section class; two classes restore the designed spacing on screen (print below). Screen papers use 84px bottom padding so a paper that grows past A4 keeps its running footer (bottom 22px, up to 56px tall) clear. */
    .quotation-print-root .quotation-print-section{padding-block:10px 0}
    @media print{${printGeometry}.loading-screen,[data-print-hide]{display:none!important}}
    ${scopePrintGeometry(printGeometry)}
    @media screen and (max-width:840px){.quotation-print-root{padding:10px;overflow-x:auto}.quotation-print-paper{margin:0}}
  `}</style><DocumentPrintController paperSelector=".quotation-print-paper" documentLabel="Quotation" verifyA4Fit printGeometryAttribute={PRINT_GEOMETRY_ATTRIBUTE} />{pages.map((page, pageIndex) => <main className="quotation-print-paper" key={pageIndex}><DocumentHeader type="QUOTATION" identity={identity} />{page.blocks.map(renderBlock)}<DocumentFooter documentNumber={q.quotation_no} customerName={customer.company} pageNumber={pageIndex + 1} pageCount={pageCount} /></main>)}</div>;
}
