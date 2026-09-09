import { notFound } from "next/navigation";
import { requireModuleAccess, requireRole } from "../../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { PRINT_WHEN_READY_SCRIPT } from "../../../../lib/print-when-ready";
import { formatMalaysiaDate } from "../../../../lib/date-time";
import type { SalesQuotationItemRow, SalesQuotationRow } from "../../../../lib/sales/crm";

export const metadata = { title: "Quotation PDF — TERAS UNIVERSAL", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const REG_NO = "202201038223 (1477529-X)";
const SANS = "'Helvetica Neue',Helvetica,Arial,sans-serif";

function fmt(value: number) {
  return `RM ${Number(value).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;
}

export default async function QuotationPdfPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("editor");
  await requireModuleAccess("sales_quotations");
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: quotation } = await supabase.from("sales_quotations").select("*").eq("id", id).maybeSingle();
  if (!quotation) notFound();
  const q = quotation as SalesQuotationRow;
  const [{ data: opportunity }, { data: itemRows }] = await Promise.all([
    supabase.from("sales_opportunities").select("company_name, contact_person, contact_email, contact_phone, programme").eq("id", q.opportunity_id).maybeSingle(),
    supabase.from("sales_quotation_items").select("*").eq("quotation_id", id).order("sort_order"),
  ]);
  const items = (itemRows ?? []) as SalesQuotationItemRow[];

  return (
    <div className="quotation-pdf-shell" style={{ background: "#eef1f6", minHeight: "100vh", padding: 20, fontFamily: SANS }}>
      <style>{`@page { size: A4 portrait; margin: 0; } @media print { html, body { margin: 0 !important; padding: 0 !important; } .quotation-pdf-shell { padding: 0 !important; min-height: 0 !important; background: #fff !important; } .quotation-pdf-page { box-shadow: none !important; margin: 0 !important; } * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; } }`}</style>
      <div className="quotation-pdf-page" style={{ width: 794, minHeight: 1123, margin: "0 auto", background: "#fff", boxShadow: "0 0 0 1px rgba(0,0,0,.06)", padding: "48px 56px", boxSizing: "border-box", color: "#1a2233" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "3px solid #0B3A63", paddingBottom: 16, marginBottom: 24 }}>
          <div><div style={{ fontSize: 20, fontWeight: 800, color: "#0B3A63" }}>TERAS UNIVERSAL SDN. BHD.</div><div style={{ fontSize: 11, color: "#667085" }}>Reg. No. {REG_NO}</div></div>
          <div style={{ textAlign: "right" }}><div style={{ fontSize: 22, fontWeight: 800, letterSpacing: 1 }}>QUOTATION</div><div style={{ fontSize: 13, marginTop: 4 }}>{q.quotation_no} · {q.revision_no === 0 ? "Original" : `Revision ${q.revision_no}`}</div></div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 24, fontSize: 12.5 }}>
          <div><div style={{ fontSize: 11, color: "#667085", textTransform: "uppercase", marginBottom: 4 }}>Prepared For</div><div style={{ fontWeight: 700 }}>{opportunity?.contact_person ?? opportunity?.company_name ?? "Client"}</div>{opportunity?.company_name && <div>{opportunity.company_name}</div>}{opportunity?.contact_email && <div>{opportunity.contact_email}</div>}{opportunity?.contact_phone && <div>{opportunity.contact_phone}</div>}</div>
          <div style={{ textAlign: "right" }}><div><span style={{ color: "#667085" }}>Issue Date: </span>{formatMalaysiaDate(q.issue_date)}</div><div><span style={{ color: "#667085" }}>Valid Until: </span>{q.valid_until ? formatMalaysiaDate(q.valid_until) : "No expiry"}</div>{opportunity?.programme && <div><span style={{ color: "#667085" }}>Programme: </span>{opportunity.programme}</div>}</div>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginBottom: 16 }}><thead><tr style={{ background: "#f3f5f9", textAlign: "left" }}><th style={{ padding: "8px 6px" }}>Description</th><th style={{ padding: "8px 6px", textAlign: "right" }}>Qty</th><th style={{ padding: "8px 6px", textAlign: "right" }}>Unit Price</th><th style={{ padding: "8px 6px", textAlign: "right" }}>Discount</th><th style={{ padding: "8px 6px", textAlign: "right" }}>Line Total</th></tr></thead><tbody>{items.map((item) => <tr key={item.id} style={{ borderBottom: "1px solid #eef1f6" }}><td style={{ padding: "8px 6px" }}>{item.description}</td><td style={{ padding: "8px 6px", textAlign: "right" }}>{item.quantity} {item.unit}</td><td style={{ padding: "8px 6px", textAlign: "right" }}>{fmt(item.unit_price)}</td><td style={{ padding: "8px 6px", textAlign: "right" }}>{fmt(item.discount)}</td><td style={{ padding: "8px 6px", textAlign: "right" }}>{fmt(item.line_total)}</td></tr>)}</tbody></table>
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 24 }}><table style={{ fontSize: 12.5, minWidth: 260 }}><tbody><tr><td style={{ padding: "3px 0", color: "#667085" }}>Subtotal</td><td style={{ padding: "3px 0", textAlign: "right" }}>{fmt(q.subtotal)}</td></tr><tr><td style={{ padding: "3px 0", color: "#667085" }}>Discount</td><td style={{ padding: "3px 0", textAlign: "right" }}>− {fmt(q.discount)}</td></tr><tr><td style={{ padding: "3px 0", color: "#667085" }}>Tax {q.sst_applicable ? `(SST ${q.sst_rate}%)` : ""}</td><td style={{ padding: "3px 0", textAlign: "right" }}>{fmt(q.tax)}</td></tr><tr style={{ borderTop: "2px solid #0B3A63" }}><td style={{ padding: "6px 0", fontWeight: 800 }}>Grand Total</td><td style={{ padding: "6px 0", textAlign: "right", fontWeight: 800 }}>{fmt(q.total)}</td></tr></tbody></table></div>
        {q.terms && <div style={{ marginBottom: 16, fontSize: 12 }}><div style={{ fontSize: 11, color: "#667085", textTransform: "uppercase", marginBottom: 4 }}>Terms</div><div style={{ whiteSpace: "pre-wrap" }}>{q.terms}</div></div>}
        {q.notes && <div style={{ marginBottom: 16, fontSize: 12 }}><div style={{ fontSize: 11, color: "#667085", textTransform: "uppercase", marginBottom: 4 }}>Notes</div><div style={{ whiteSpace: "pre-wrap" }}>{q.notes}</div></div>}
        <div style={{ marginTop: 32, paddingTop: 12, borderTop: "1px solid #eef1f6", fontSize: 11, color: "#667085" }}>This quotation is valid until the date shown above. Please contact TERAS UNIVERSAL SDN. BHD. with any questions.</div>
      </div>
      <script dangerouslySetInnerHTML={{ __html: PRINT_WHEN_READY_SCRIPT }} />
    </div>
  );
}
