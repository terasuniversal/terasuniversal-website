import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import { requireRole } from "../../../../../../lib/auth/session";
import { isAdmin } from "../../../../../../lib/auth/rbac";
import { PageHead, Card, Badge, EmptyState } from "../../../../../../components/admin/ui";
import { revisionLabel, type SalesQuotationRow, type SalesQuotationItemRow } from "../../../../../../lib/sales/crm";
import { QuotationItemsEditor } from "../QuotationItemsEditor";
import { QuotationActionsPanel } from "./QuotationActionsPanel";
import { updateQuotationDraft } from "../actions";

export const metadata = { title: "Quotation Detail — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

export default async function QuotationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireRole("editor");
  const canManage = isAdmin(profile.role);
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: quotation } = await supabase.from("sales_quotations").select("*").eq("id", id).maybeSingle();
  if (!quotation) notFound();
  const q = quotation as SalesQuotationRow;

  const { data: opportunity } = await supabase.from("sales_opportunities").select("id, opportunity_no, company_name").eq("id", q.opportunity_id).maybeSingle();
  const { data: itemRows } = await supabase.from("sales_quotation_items").select("*").eq("quotation_id", id).order("sort_order");
  const items = (itemRows ?? []) as SalesQuotationItemRow[];

  let chain: { id: string; revision_no: number; status: string }[] = [];
  if (q.quotation_no) {
    const { data: chainRows } = await supabase
      .from("sales_quotations")
      .select("id, revision_no, status")
      .eq("quotation_no", q.quotation_no)
      .order("revision_no", { ascending: true });
    chain = chainRows ?? [];
  }

  return (
    <>
      <PageHead
        title={`${q.quotation_no} (${revisionLabel(q.revision_no)})`}
        subtitle={opportunity ? `${opportunity.opportunity_no} — ${opportunity.company_name ?? "No company on file"}` : undefined}
        action={opportunity ? <Link href={`/admin/sales/opportunities/${opportunity.id}`} className="ta-btn ta-btn-outline">← Back to Opportunity</Link> : undefined}
      />

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
        <Badge status={q.status} />
        <span style={{ color: "var(--ta-muted)", fontSize: 13 }}>
          Issued {new Date(q.issue_date).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" })}
        </span>
        {q.rejection_reason && <span style={{ color: "var(--ta-muted)", fontSize: 13 }}>Rejected — {q.rejection_reason}</span>}
      </div>

      {chain.length > 1 && (
        <Card title="Revision History">
          <div className="ta-card-pad" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {chain.map((c) => (
              <Link
                key={c.id}
                href={`/admin/sales/quotations/${c.id}`}
                className="ta-btn ta-btn-sm"
                style={c.id === id ? { background: "var(--ta-navy, #0B3A63)", color: "#fff" } : undefined}
              >
                {revisionLabel(c.revision_no)} · {c.status}
              </Link>
            ))}
          </div>
        </Card>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 20, alignItems: "start", marginTop: 16 }}>
        <div>
          {q.status === "draft" && canManage ? (
            <QuotationItemsEditor
              action={updateQuotationDraft.bind(null, id)}
              initialHeader={{ valid_until: q.valid_until, currency: q.currency, discount: Number(q.discount), sst_applicable: q.sst_applicable, sst_rate: Number(q.sst_rate), terms: q.terms, notes: q.notes }}
              initialItems={items.map((i) => ({ description: i.description, quantity: String(i.quantity), unit: i.unit, unit_price: String(i.unit_price), discount: String(i.discount) }))}
              submitLabel="Save Changes"
            />
          ) : (
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
                          <td>RM {Number(item.unit_price).toLocaleString("en-MY", { minimumFractionDigits: 2 })}</td>
                          <td>RM {Number(item.discount).toLocaleString("en-MY", { minimumFractionDigits: 2 })}</td>
                          <td>RM {Number(item.line_total).toLocaleString("en-MY", { minimumFractionDigits: 2 })}</td>
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
                  <dt>Subtotal</dt><dd style={{ margin: 0, textAlign: "right" }}>RM {Number(q.subtotal).toLocaleString("en-MY", { minimumFractionDigits: 2 })}</dd>
                  <dt>Discount</dt><dd style={{ margin: 0, textAlign: "right" }}>− RM {Number(q.discount).toLocaleString("en-MY", { minimumFractionDigits: 2 })}</dd>
                  <dt>Tax {q.sst_applicable ? `(SST ${q.sst_rate}%)` : "(not applicable)"}</dt><dd style={{ margin: 0, textAlign: "right" }}>RM {Number(q.tax).toLocaleString("en-MY", { minimumFractionDigits: 2 })}</dd>
                  <dt><strong>Grand Total</strong></dt><dd style={{ margin: 0, textAlign: "right" }}><strong>RM {Number(q.total).toLocaleString("en-MY", { minimumFractionDigits: 2 })}</strong></dd>
                </dl>
                {q.terms && (
                  <>
                    <h4 style={{ fontSize: 13, color: "var(--ta-muted)", margin: "16px 0 6px" }}>Terms</h4>
                    <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{q.terms}</p>
                  </>
                )}
              </div>
            </Card>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <QuotationActionsPanel quotationId={id} status={q.status} canManage={canManage} />
        </div>
      </div>
    </>
  );
}
