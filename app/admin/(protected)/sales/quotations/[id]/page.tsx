import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import { requireRole, requireModuleAccess } from "../../../../../../lib/auth/session";
import { isAdmin } from "../../../../../../lib/auth/rbac";
import { PageHead, Card, Badge, EmptyState } from "../../../../../../components/admin/ui";
import { dueDateState, revisionLabel, type SalesActivityRow, type SalesQuotationRow, type SalesQuotationItemRow, type SalesTaskRow } from "../../../../../../lib/sales/crm";
import { formatMalaysiaDate, formatMalaysiaDateTime } from "../../../../../../lib/date-time";
import { invoiceStatusLabel, paymentVisibilityLabel, pickNextQuotationTask, QUOTATION_EXPIRY_LABELS, quotationExpiryState } from "../../../../../../lib/sales/quotation-workflow";
import { LeadActivityTimeline } from "../../leads/[id]/LeadActivityTimeline";
import { QuotationItemsEditor } from "../QuotationItemsEditor";
import { QuotationActionsPanel } from "./QuotationActionsPanel";
import { updateQuotationDraft } from "../actions";

export const metadata = { title: "Quotation Detail — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

export default async function QuotationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireRole("editor");
  await requireModuleAccess("sales_quotations");
  const canManage = isAdmin(profile.role);
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: quotation } = await supabase.from("sales_quotations").select("*").eq("id", id).maybeSingle();
  if (!quotation) notFound();
  const q = quotation as SalesQuotationRow;

  const { data: opportunity } = await supabase.from("sales_opportunities").select("id, opportunity_no, company_name").eq("id", q.opportunity_id).maybeSingle();
  const { data: itemRows } = await supabase.from("sales_quotation_items").select("*").eq("quotation_id", id).order("sort_order");
  const items = (itemRows ?? []) as SalesQuotationItemRow[];
  const { data: existingInvoice } = await supabase.from("invoices").select("id, invoice_no, status, grand_total, amount_paid, balance_due, invoice_date, due_date").eq("quotation_id", id).maybeSingle();
  const { data: paymentRows } = existingInvoice
    ? await supabase.from("invoice_payments").select("status, payment_provider").eq("invoice_id", existingInvoice.id)
    : { data: [] as { status: string; payment_provider: string }[] };
  const { data: taskRows } = await supabase.from("sales_tasks").select("*").eq("quotation_id", id).is("deleted_at", null).not("status", "in", "(completed,cancelled)");
  const nextTask = pickNextQuotationTask((taskRows ?? []) as SalesTaskRow[]);
  const expiry = quotationExpiryState(q.valid_until);
  const nextTaskState = nextTask ? dueDateState(nextTask.due_at) : "none";
  const { data: activityRows } = await supabase.from("sales_activity").select("*").eq("quotation_id", id).order("created_at", { ascending: true });
  const actorIds = Array.from(new Set(((activityRows ?? []) as SalesActivityRow[]).map((activity) => activity.actor_id).filter(Boolean))) as string[];
  const { data: actorRows } = actorIds.length > 0 ? await supabase.from("profiles").select("id, full_name").in("id", actorIds) : { data: [] };
  const actorNames = new Map(((actorRows ?? []) as { id: string; full_name: string }[]).map((actor) => [actor.id, actor.full_name]));

  let chain: { id: string; revision_no: number; status: string; total: number; created_at: string; sent_at: string | null; accepted_at: string | null; rejected_at: string | null; superseded_at: string | null }[] = [];
  if (q.quotation_no) {
    const { data: chainRows } = await supabase
      .from("sales_quotations")
      .select("id, revision_no, status, total, created_at, sent_at, accepted_at, rejected_at, superseded_at")
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

      <div className="ta-lead-meta">
        <Badge status={q.status} />
        <span className="ta-lead-meta-time">
          Issued {formatMalaysiaDate(q.issue_date)}
        </span>
        <span className="ta-lead-meta-time">{QUOTATION_EXPIRY_LABELS[expiry]}</span>
        {q.rejection_reason && <span className="ta-lead-meta-time">Rejected — {q.rejection_reason}</span>}
        {q.cancellation_reason && <span className="ta-lead-meta-time">Cancelled — {q.cancellation_reason}</span>}
      </div>

      <Card title="Quotation Workflow">
        <div className="ta-card-pad" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
          <div><div style={{ color: "var(--ta-muted)", fontSize: 12 }}>Status</div><strong><Badge status={q.status} /></strong></div>
          <div><div style={{ color: "var(--ta-muted)", fontSize: 12 }}>Revision</div><strong>{revisionLabel(q.revision_no)}</strong></div>
          <div><div style={{ color: "var(--ta-muted)", fontSize: 12 }}>Valid until</div><strong>{q.valid_until ? formatMalaysiaDate(q.valid_until) : "No expiry"}</strong></div>
          <div><div style={{ color: "var(--ta-muted)", fontSize: 12 }}>Expiry</div><strong style={{ color: expiry === "expired" ? "var(--ta-danger)" : undefined }}>{QUOTATION_EXPIRY_LABELS[expiry]}</strong></div>
          {q.sent_at && <div><div style={{ color: "var(--ta-muted)", fontSize: 12 }}>Sent</div><strong>{formatMalaysiaDateTime(q.sent_at)}</strong></div>}
          {q.accepted_at && <div><div style={{ color: "var(--ta-muted)", fontSize: 12 }}>Accepted</div><strong>{formatMalaysiaDateTime(q.accepted_at)}</strong></div>}
          {q.rejected_at && <div><div style={{ color: "var(--ta-muted)", fontSize: 12 }}>Rejected</div><strong>{formatMalaysiaDateTime(q.rejected_at)}</strong></div>}
          {q.cancelled_at && <div><div style={{ color: "var(--ta-muted)", fontSize: 12 }}>Cancelled</div><strong>{formatMalaysiaDateTime(q.cancelled_at)}</strong></div>}
          {q.rejection_reason && <div style={{ gridColumn: "1 / -1" }}><div style={{ color: "var(--ta-muted)", fontSize: 12 }}>Rejection reason</div><div style={{ whiteSpace: "pre-wrap" }}>{q.rejection_reason}</div></div>}
          {q.cancellation_reason && <div style={{ gridColumn: "1 / -1" }}><div style={{ color: "var(--ta-muted)", fontSize: 12 }}>Cancellation reason</div><div style={{ whiteSpace: "pre-wrap" }}>{q.cancellation_reason}</div></div>}
        </div>
      </Card>

      {chain.length > 1 && (
        <Card title="Revision History">
          <div className="ta-card-pad" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <div className="ta-table-wrap" style={{ width: "100%" }}><table className="ta-table"><thead><tr><th>Revision</th><th>Status</th><th>Total</th><th>Created</th><th>Sent</th><th></th></tr></thead><tbody>{chain.map((c) => <tr key={c.id} style={c.id === id ? { background: "rgba(11,58,99,.06)" } : undefined}><td><Link href={`/admin/sales/quotations/${c.id}`}><strong>{revisionLabel(c.revision_no)}</strong></Link></td><td><Badge status={c.status} /></td><td>RM {Number(c.total).toLocaleString("en-MY", { minimumFractionDigits: 2 })}</td><td>{formatMalaysiaDate(c.created_at)}</td><td>{c.sent_at ? formatMalaysiaDate(c.sent_at) : "—"}</td><td>{c.id === id ? <span style={{ color: "var(--ta-muted)", fontSize: 12 }}>Current</span> : <Link href={`/admin/sales/quotations/${c.id}`} className="ta-btn ta-btn-outline ta-btn-sm">View</Link>}</td></tr>)}</tbody></table></div>
          </div>
        </Card>
      )}

      <div className="ta-lead-detail-grid" style={{ marginTop: 16 }}>
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
                {q.notes && <><h4 style={{ fontSize: 13, color: "var(--ta-muted)", margin: "16px 0 6px" }}>Notes</h4><p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{q.notes}</p></>}
              </div>
            </Card>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <Card title="Quotation Documents">
            <div className="ta-card-pad" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><Link href={`/admin/quotation-pdf/${id}`} className="ta-btn ta-btn-outline ta-btn-sm" target="_blank">Print / PDF</Link></div>
          </Card>
          <Card title="Next Action">
            <div className="ta-card-pad">{nextTask ? <><strong>{nextTask.title}</strong><div style={{ color: nextTaskState === "overdue" ? "var(--ta-danger)" : "var(--ta-muted)", fontSize: 13, marginTop: 4 }}>{nextTask.due_at ? formatMalaysiaDateTime(nextTask.due_at) : "No due date"} · {nextTaskState === "none" ? "Not scheduled" : nextTaskState}</div><div style={{ fontSize: 12, marginTop: 4 }}>Status: {nextTask.status.replace(/_/g, " ")}</div></> : <span style={{ color: "var(--ta-muted)" }}>No active quotation task.</span>}</div>
          </Card>
          {existingInvoice && <Card title="Invoice & Payment Summary"><div className="ta-card-pad" style={{ display: "grid", gap: 7, fontSize: 13 }}><div><strong>{existingInvoice.invoice_no}</strong> · <Badge status={existingInvoice.status} /></div><div>Total: RM {Number(existingInvoice.grand_total).toLocaleString("en-MY", { minimumFractionDigits: 2 })}</div><div>Paid: RM {Number(existingInvoice.amount_paid).toLocaleString("en-MY", { minimumFractionDigits: 2 })}</div><div>Balance due: RM {Number(existingInvoice.balance_due).toLocaleString("en-MY", { minimumFractionDigits: 2 })}</div><div>Payment: {paymentVisibilityLabel(existingInvoice.status, (paymentRows ?? []).map((payment: any) => payment.status))}</div><div>Issue date: {formatMalaysiaDate(existingInvoice.invoice_date)} · Due: {formatMalaysiaDate(existingInvoice.due_date)}</div><Link href={`/admin/invoices/${existingInvoice.id}`} className="ta-btn ta-btn-outline ta-btn-sm" style={{ justifySelf: "start" }}>View Invoice</Link></div></Card>}
          <QuotationActionsPanel quotationId={id} status={q.status} canManage={canManage} existingInvoiceId={existingInvoice?.id ?? null} />
        </div>
      </div>
      <div style={{ marginTop: 20 }}><LeadActivityTimeline activities={(activityRows ?? []) as SalesActivityRow[]} actorNames={actorNames} /></div>
    </>
  );
}
