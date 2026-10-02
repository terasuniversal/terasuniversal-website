import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import { requireRole, requireModuleAccess } from "../../../../../../lib/auth/session";
import { isAdmin } from "../../../../../../lib/auth/rbac";
import { PageHead, Card, Badge, EmptyState, ReadErrorState } from "../../../../../../components/admin/ui";
import { dueDateState, revisionLabel, type SalesActivityRow, type SalesQuotationRow, type SalesQuotationItemRow, type SalesTaskRow } from "../../../../../../lib/sales/crm";
import { formatMalaysiaDate, formatMalaysiaDateTime } from "../../../../../../lib/date-time";
import { invoiceStatusLabel, paymentVisibilityLabel, pickNextQuotationTask, QUOTATION_EXPIRY_LABELS, quotationExpiryState } from "../../../../../../lib/sales/quotation-workflow";
import { LeadActivityTimeline } from "../../leads/[id]/LeadActivityTimeline";
import { QuotationItemsEditor } from "../QuotationItemsEditor";
import { QuotationActionsPanel } from "./QuotationActionsPanel";
import { updateQuotationDraft } from "../actions";
import { loadCourseCommercialOptions, normalizePackageIncludeItems } from "../../../../../../lib/sales/course-commercial";

export const metadata = { title: "Quotation Detail — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

export default async function QuotationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireRole("editor");
  await requireModuleAccess("sales_quotations");
  const canManage = isAdmin(profile.role);
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: quotation, error: quotationReadError } = await supabase.from("sales_quotations").select("*").eq("id", id).maybeSingle();
  if (quotationReadError) return <><PageHead title="Quotation detail" /><ReadErrorState message="Quotation details could not be loaded. Retry the page." /></>;
  if (!quotation) notFound();
  const q = quotation as SalesQuotationRow;

  const { data: opportunity, error: opportunityReadError } = await supabase.from("sales_opportunities").select("id, opportunity_no, company_name, contact_person, contact_email, contact_phone, company_id").eq("id", q.opportunity_id).maybeSingle();
  const { data: company, error: companyReadError } = opportunity?.company_id
    ? await supabase.from("companies").select("company_name, registration_no, email, phone, person_in_charge, pic_email, pic_phone, billing_address, address").eq("id", opportunity.company_id).maybeSingle()
    : { data: null, error: null };
  const customer = {
    company: q.customer_company_name ?? company?.company_name ?? opportunity?.company_name,
    contact: q.customer_contact_name ?? company?.person_in_charge ?? opportunity?.contact_person,
    registration: q.customer_registration_no ?? company?.registration_no,
    email: q.customer_email ?? company?.email ?? company?.pic_email ?? opportunity?.contact_email,
    phone: q.customer_phone ?? company?.phone ?? company?.pic_phone ?? opportunity?.contact_phone,
  };
  const { data: itemRows, error: itemReadError } = await supabase.from("sales_quotation_items").select("*").eq("quotation_id", id).order("sort_order");
  const items = (itemRows ?? []) as SalesQuotationItemRow[];
  const courseOptions = await loadCourseCommercialOptions(supabase);
  const { data: existingInvoice, error: invoiceReadError } = await supabase.from("invoices").select("id, invoice_no, status, grand_total, amount_paid, balance_due, invoice_date, due_date").eq("quotation_id", id).maybeSingle();
  const { data: paymentRows, error: paymentReadError } = existingInvoice
    ? await supabase.from("invoice_payments").select("status, payment_provider").eq("invoice_id", existingInvoice.id)
    : { data: [] as { status: string; payment_provider: string }[], error: null };
  const { data: taskRows, error: taskReadError } = await supabase.from("sales_tasks").select("*").eq("quotation_id", id).is("deleted_at", null).not("status", "in", "(completed,cancelled)");
  const nextTask = pickNextQuotationTask((taskRows ?? []) as SalesTaskRow[]);
  const expiry = quotationExpiryState(q.valid_until);
  const nextTaskState = nextTask ? dueDateState(nextTask.due_at) : "none";
  const { data: activityRows, error: activityReadError } = await supabase.from("sales_activity").select("*").eq("quotation_id", id).order("created_at", { ascending: true });
  const actorIds = Array.from(new Set(((activityRows ?? []) as SalesActivityRow[]).map((activity) => activity.actor_id).filter(Boolean))) as string[];
  const { data: actorRows, error: actorReadError } = actorIds.length > 0 ? await supabase.from("profiles").select("id, full_name").in("id", actorIds) : { data: [], error: null };
  const actorNames = new Map(((actorRows ?? []) as { id: string; full_name: string }[]).map((actor) => [actor.id, actor.full_name]));

  let chain: { id: string; revision_no: number; status: string; total: number; created_at: string; sent_at: string | null; accepted_at: string | null; rejected_at: string | null; superseded_at: string | null }[] = [];
  let chainReadError: unknown = null;
  if (q.quotation_no) {
    const { data: chainRows, error } = await supabase
      .from("sales_quotations")
      .select("id, revision_no, status, total, created_at, sent_at, accepted_at, rejected_at, superseded_at")
      .eq("quotation_no", q.quotation_no)
      .order("revision_no", { ascending: true });
    chain = chainRows ?? [];
    chainReadError = error;
  }

  const primaryAction = q.status === "draft" && canManage && !itemReadError
    ? <Link href="#quotation-editor" className="ta-btn ta-btn-primary">Edit draft</Link>
    : q.status === "sent" && canManage
      ? <Link href="#quotation-primary-action" className="ta-btn ta-btn-primary">Review sent actions</Link>
      : q.status === "accepted" && invoiceReadError
        ? undefined
        : q.status === "accepted" && existingInvoice
          ? <Link href={`/admin/invoices/${existingInvoice.id}`} className="ta-btn ta-btn-primary">View invoice</Link>
          : q.status === "accepted" && canManage
            ? <Link href="#quotation-primary-action" className="ta-btn ta-btn-primary">Create invoice</Link>
            : (q.status === "rejected" || q.status === "expired") && canManage
              ? <Link href="#quotation-primary-action" className="ta-btn ta-btn-primary">Create revision</Link>
              : undefined;

  return (
    <>
      <PageHead
        title={`${q.quotation_no} (${revisionLabel(q.revision_no)})`}
        subtitle={opportunity ? `${opportunity.opportunity_no} — ${opportunity.company_name ?? "No company on file"}` : undefined}
        action={primaryAction}
        secondaryAction={opportunity ? <Link href={`/admin/sales/opportunities/${opportunity.id}`} className="ta-btn ta-btn-outline">← Back to Opportunity</Link> : undefined}
      />
      {(opportunityReadError || companyReadError) && <ReadErrorState title="Customer relationship unavailable" message="The related opportunity or company details could not be fully loaded. Retry the page to refresh the relationship context." />}

      <div className="ta-lead-meta">
        <Badge status={q.status} />
        <span className="ta-lead-meta-time">
          Issued {formatMalaysiaDate(q.issue_date)}
        </span>
        <span className="ta-lead-meta-time">{QUOTATION_EXPIRY_LABELS[expiry]}</span>
        {q.rejection_reason && <span className="ta-lead-meta-time">Rejected — {q.rejection_reason}</span>}
        {q.cancellation_reason && <span className="ta-lead-meta-time">Cancelled — {q.cancellation_reason}</span>}
      </div>

      <section className="ta-quotation-summary" aria-label="Quotation overview">
        <div className="ta-quotation-summary-primary">
          <div><span>Status</span><strong><Badge status={q.status} /></strong></div>
          <div><span>Revision</span><strong>{revisionLabel(q.revision_no)}{q.superseded_at ? " · Superseded" : ""}</strong></div>
          <div><span>Customer</span><strong>{customer.company ?? "Customer not recorded"}</strong><small>{customer.contact ?? "Contact not recorded"}</small></div>
          <div><span>Related Opportunity</span><strong>{opportunity ? <Link href={`/admin/sales/opportunities/${opportunity.id}`}>{opportunity.opportunity_no} →</Link> : "Opportunity not available"}</strong></div>
          <div><span>Total</span><strong>RM {Number(q.total).toLocaleString("en-MY", { minimumFractionDigits: 2 })}</strong></div>
          <div><span>Issue / Validity</span><strong>{formatMalaysiaDate(q.issue_date)} · {q.valid_until ? formatMalaysiaDate(q.valid_until) : "No expiry"}</strong><small>{QUOTATION_EXPIRY_LABELS[expiry]}</small></div>
        </div>
        <div className="ta-quotation-summary-history" aria-label="Quotation lifecycle dates">
          {q.sent_at && <span>Sent {formatMalaysiaDateTime(q.sent_at)}</span>}
          {q.accepted_at && <span>Accepted {formatMalaysiaDateTime(q.accepted_at)}</span>}
          {q.rejected_at && <span>Rejected {formatMalaysiaDateTime(q.rejected_at)}</span>}
          {q.cancelled_at && <span>Cancelled {formatMalaysiaDateTime(q.cancelled_at)}</span>}
          {q.rejection_reason && <span>Rejection reason: {q.rejection_reason}</span>}
          {q.cancellation_reason && <span>Cancellation reason: {q.cancellation_reason}</span>}
        </div>
      </section>

      {chainReadError ? <ReadErrorState title="Revision history unavailable" message="Quotation revisions could not be loaded. Retry the page; history is not being treated as empty." /> : chain.length > 1 && (
        <Card title="Revision History">
          <div className="ta-card-pad" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <div className="ta-table-wrap" style={{ width: "100%" }}><table className="ta-table"><thead><tr><th>Revision</th><th>Status</th><th>Total</th><th>Created</th><th>Sent</th><th></th></tr></thead><tbody>{chain.map((c) => <tr key={c.id} style={c.id === id ? { background: "rgba(11,58,99,.06)" } : undefined}><td><Link href={`/admin/sales/quotations/${c.id}`}><strong>{revisionLabel(c.revision_no)}</strong></Link></td><td><Badge status={c.status} /></td><td>RM {Number(c.total).toLocaleString("en-MY", { minimumFractionDigits: 2 })}</td><td>{formatMalaysiaDate(c.created_at)}</td><td>{c.sent_at ? formatMalaysiaDate(c.sent_at) : "—"}</td><td>{c.id === id ? <span style={{ color: "var(--ta-muted)", fontSize: 12 }}>Current</span> : <Link href={`/admin/sales/quotations/${c.id}`} className="ta-btn ta-btn-outline ta-btn-sm">View</Link>}</td></tr>)}</tbody></table></div>
          </div>
        </Card>
      )}

      <div className="ta-lead-detail-grid" style={{ marginTop: 16 }}>
        <div>
          {itemReadError ? <ReadErrorState title="Line items unavailable" message="Quotation line items could not be loaded. Editing is paused so a failed read cannot appear as an empty draft." /> : q.status === "draft" && canManage ? (
            <div id="quotation-editor"><QuotationItemsEditor
              action={updateQuotationDraft.bind(null, id)}
              initialHeader={{ valid_until: q.valid_until, currency: q.currency, discount: Number(q.discount), sst_applicable: q.sst_applicable, sst_rate: Number(q.sst_rate), terms: q.terms, notes: q.notes, customer_company_name: q.customer_company_name ?? customer.company, customer_contact_name: q.customer_contact_name ?? customer.contact, customer_registration_no: q.customer_registration_no ?? customer.registration, customer_email: q.customer_email ?? customer.email, customer_phone: q.customer_phone ?? customer.phone, billing_address: q.billing_address ?? company?.billing_address ?? company?.address, training_service_address: q.training_service_address }}
              initialItems={items.map((i) => ({ description: i.description, quantity: String(i.quantity), unit: i.unit, unit_price: String(i.unit_price), discount: String(i.discount), course_id: i.course_id ?? "", course_name_snapshot: i.course_name_snapshot ?? "", hrdf_claim: i.hrdf_claim ?? false, package_includes_snapshot: normalizePackageIncludeItems(i.package_includes_snapshot) }))}
              courseOptions={courseOptions}
              submitLabel="Save Changes"
            /></div>
          ) : (
          <Card title="Line Items">
              {items.length > 0 ? (
                <div className="ta-table-wrap ta-quotation-editor-table">
                                  <table className="ta-table">
                    <thead><tr><th>Description</th><th>Qty</th><th>Unit</th><th>Unit Price</th><th>Discount</th><th>Line Total</th></tr></thead>
                    <tbody>
                      {items.map((item) => (
                        <tr key={item.id}>
                          <td data-label="Description">
                            {item.course_name_snapshot && <div style={{ fontWeight: 600, marginBottom: 4 }}>Course: {item.course_name_snapshot}{item.hrdf_claim ? " (HRDF)" : ""}</div>}
                            <div style={{ whiteSpace: "pre-wrap" }}>{item.description}</div>
                            {item.package_includes_snapshot.length > 0 && <div style={{ marginTop: 6, fontSize: 12, color: "var(--ta-muted)" }}><strong>Package Includes:</strong> {normalizePackageIncludeItems(item.package_includes_snapshot).map((entry) => entry.label).join(", ")}</div>}
                          </td>
                          <td data-label="Quantity">{item.quantity}</td>
                          <td data-label="Unit">{item.unit}</td>
                          <td data-label="Unit price">RM {Number(item.unit_price).toLocaleString("en-MY", { minimumFractionDigits: 2 })}</td>
                          <td data-label="Discount">RM {Number(item.discount).toLocaleString("en-MY", { minimumFractionDigits: 2 })}</td>
                          <td data-label="Line total">RM {Number(item.line_total).toLocaleString("en-MY", { minimumFractionDigits: 2 })}</td>
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
          {!(q.status === "draft" && canManage) && <Card title="Customer Details">
            <div className="ta-card-pad" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
              {[["Company", customer.company], ["Attention", customer.contact], ["Registration No.", customer.registration], ["Email", customer.email], ["Phone", customer.phone]].map(([label, value]) => <div key={label}><div style={{ color: "var(--ta-muted)", fontSize: 12 }}>{label}</div><div style={{ overflowWrap: "anywhere" }}>{value || "—"}</div></div>)}
              <div style={{ gridColumn: "1 / -1" }}><div style={{ color: "var(--ta-muted)", fontSize: 12 }}>Billing Address</div><div style={{ whiteSpace: "pre-wrap" }}>{q.billing_address ?? "—"}</div></div>
              <div style={{ gridColumn: "1 / -1" }}><div style={{ color: "var(--ta-muted)", fontSize: 12 }}>Training / Service Address</div><div style={{ whiteSpace: "pre-wrap" }}>{q.training_service_address ?? "—"}</div></div>
            </div>
          </Card>}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div id="quotation-primary-action" className="ta-quotation-primary-action"><QuotationActionsPanel quotationId={id} status={q.status} canManage={canManage && !(q.status === "accepted" && invoiceReadError)} existingInvoiceId={existingInvoice?.id ?? null} /></div>
          <Card title="Quotation Documents">
            <div className="ta-card-pad" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><Link href={`/admin/quotation-pdf/${id}`} className="ta-btn ta-btn-outline ta-btn-sm" target="_blank">Print / PDF</Link></div>
          </Card>
          <Card title="Next Action">
            <div className="ta-card-pad">{taskReadError ? <ReadErrorState title="Next action unavailable" message="Quotation tasks could not be loaded. Retry the page." /> : nextTask ? <><strong>{nextTask.title}</strong><div style={{ color: nextTaskState === "overdue" ? "var(--ta-danger)" : "var(--ta-muted)", fontSize: 13, marginTop: 4 }}>{nextTask.due_at ? formatMalaysiaDateTime(nextTask.due_at) : "No due date"} · {nextTaskState === "none" ? "Not scheduled" : nextTaskState}</div><div style={{ fontSize: 12, marginTop: 4 }}>Status: {nextTask.status.replace(/_/g, " ")}</div></> : <span style={{ color: "var(--ta-muted)" }}>No active quotation task.</span>}</div>
          </Card>
          {invoiceReadError ? <ReadErrorState title="Invoice context unavailable" message="Invoice state could not be loaded. Invoice actions are paused until the related record can be checked." /> : existingInvoice && <Card title="Invoice & Payment Summary"><div className="ta-card-pad" style={{ display: "grid", gap: 7, fontSize: 13 }}><div><strong>{existingInvoice.invoice_no}</strong> · <Badge status={existingInvoice.status} /></div><div>Total: RM {Number(existingInvoice.grand_total).toLocaleString("en-MY", { minimumFractionDigits: 2 })}</div><div>Paid: RM {Number(existingInvoice.amount_paid).toLocaleString("en-MY", { minimumFractionDigits: 2 })}</div><div>Balance due: RM {Number(existingInvoice.balance_due).toLocaleString("en-MY", { minimumFractionDigits: 2 })}</div><div>Payment: {paymentReadError ? "Payment status unavailable — retry" : paymentVisibilityLabel(existingInvoice.status, (paymentRows ?? []).map((payment: any) => payment.status))}</div><div>Issue date: {formatMalaysiaDate(existingInvoice.invoice_date)} · Due: {formatMalaysiaDate(existingInvoice.due_date)}</div><Link href={`/admin/invoices/${existingInvoice.id}`} className="ta-btn ta-btn-outline ta-btn-sm" style={{ justifySelf: "start" }}>View Invoice</Link></div></Card>}

        </div>
      </div>
      <div style={{ marginTop: 20 }}>{activityReadError ? <ReadErrorState title="Activity history unavailable" message="Quotation activity could not be loaded. Retry the page." /> : actorReadError ? <ReadErrorState title="Activity names unavailable" message="Activity loaded, but actor names could not be resolved." /> : <LeadActivityTimeline activities={(activityRows ?? []) as SalesActivityRow[]} actorNames={actorNames} />}</div>
    </>
  );
}
