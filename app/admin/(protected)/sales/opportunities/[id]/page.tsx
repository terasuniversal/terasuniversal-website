import Link from "next/link";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import { requireRole } from "../../../../../../lib/auth/session";
import { isAdmin } from "../../../../../../lib/auth/rbac";
import { PageHead, Card, Badge, EmptyState } from "../../../../../../components/admin/ui";
import { LeadActivityTimeline } from "../../leads/[id]/LeadActivityTimeline";
import {
  SOURCE_LABELS,
  QUOTATION_STATUS_LABELS,
  revisionLabel,
  type SalesOpportunityRow,
  type SalesActivityRow,
  type SalesQuotationRow,
} from "../../../../../../lib/sales/crm";
import { OpportunityActionsPanel } from "./OpportunityActionsPanel";
import { TrainingHandoffPanel } from "./TrainingHandoffPanel";
import { matchCourseByProgramme } from "../../../schedules/options";

export const metadata = { title: "Opportunity Detail — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

const dl = { display: "grid", gridTemplateColumns: "170px 1fr", gap: 2, margin: 0 } as const;

function Detail({ label, value }: { label: string; value: any }) {
  return (
    <div style={{ display: "contents" }}>
      <dt style={{ color: "var(--ta-muted)", padding: "7px 0" }}>{label}</dt>
      <dd style={{ margin: 0, padding: "7px 0", fontWeight: 500 }}>{value || "—"}</dd>
    </div>
  );
}

export default async function OpportunityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireRole("editor");
  const canManage = isAdmin(profile.role);
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: opportunity } = await supabase.from("sales_opportunities").select("*").eq("id", id).maybeSingle();
  if (!opportunity) notFound();
  const opp = opportunity as SalesOpportunityRow;

  const { data: leadRow } = await supabase.from("v_sales_lead_inbox").select("lead_source, source_id, status").eq("lead_metadata_id", opp.lead_metadata_id).maybeSingle();

  const { data: quotationRows } = await supabase
    .from("sales_quotations")
    .select("*")
    .eq("opportunity_id", id)
    .order("quotation_no", { ascending: true })
    .order("revision_no", { ascending: true });

  const { data: activityRows } = await supabase
    .from("sales_activity")
    .select("*")
    .eq("opportunity_id", id)
    .order("created_at", { ascending: true });

  const { data: staffRows } = await supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name");
  const staff = (staffRows ?? []) as { id: string; full_name: string }[];

  const { data: allProfiles } = await supabase.from("profiles").select("id, full_name");
  const actorNames = new Map(((allProfiles ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]));

  // --------------------------------------------------------------------
  // Sales CRM Phase 3 — Won Opportunity -> Training Operations handoff.
  // Only relevant once the opportunity is won; every other stage skips
  // these extra queries entirely.
  // --------------------------------------------------------------------
  let handoffPanel: ReactNode = null;
  if (opp.stage === "won") {
    const acceptedQuotation = (quotationRows as SalesQuotationRow[] | null)?.find((q) => q.status === "accepted") ?? null;

    const { data: existingScheduleRow } = await supabase
      .from("course_schedules")
      .select("id, schedule_code")
      .eq("source_opportunity_id", opp.id)
      .is("deleted_at", null)
      .maybeSingle();

    // Participant count / location / preferred month only exist on the
    // proposal_requests source row — an enquiry-sourced lead genuinely has
    // none of these, so they stay null rather than being guessed.
    let participants: number | null = null;
    let location: string | null = null;
    let preferredMonth: string | null = null;
    let objectives: string | null = null;
    if (leadRow?.lead_source === "proposal_request" && leadRow.source_id) {
      const { data: pr } = await supabase
        .from("proposal_requests")
        .select("participants, location, preferred_month, objectives")
        .eq("id", leadRow.source_id)
        .maybeSingle();
      if (pr) {
        participants = pr.participants ?? null;
        location = pr.location ?? null;
        preferredMonth = pr.preferred_month ?? null;
        objectives = pr.objectives ?? null;
      }
    } else if (leadRow?.lead_source === "enquiry" && leadRow.source_id) {
      const { data: enq } = await supabase.from("enquiries").select("message").eq("id", leadRow.source_id).maybeSingle();
      objectives = enq?.message ?? null;
    }

    const matchedCourseId = acceptedQuotation ? await matchCourseByProgramme(opp.programme) : null;

    const contextLines = [
      `Sales handoff — Opportunity ${opp.opportunity_no}${acceptedQuotation ? ` / Quotation ${acceptedQuotation.quotation_no}` : ""}`,
      opp.company_name ? `Company: ${opp.company_name}` : null,
      opp.contact_person ? `Contact: ${opp.contact_person}${opp.contact_email ? ` (${opp.contact_email})` : ""}${opp.contact_phone ? `, ${opp.contact_phone}` : ""}` : null,
      acceptedQuotation ? `Quotation total: RM ${Number(acceptedQuotation.total).toLocaleString("en-MY", { minimumFractionDigits: 2 })} (commercial context only — not a fee/pricing input)` : null,
      preferredMonth ? `Preferred month (staff must confirm actual dates): ${preferredMonth}` : null,
      objectives ? `Objectives/notes: ${objectives}` : null,
    ].filter(Boolean);

    const createParams = new URLSearchParams({ opportunityId: opp.id });
    if (acceptedQuotation) createParams.set("quotationId", acceptedQuotation.id);
    if (matchedCourseId) createParams.set("courseId", matchedCourseId);
    if (participants != null) createParams.set("capacity", String(participants));
    if (location) createParams.set("venue", location);
    createParams.set("notes", contextLines.join("\n"));

    handoffPanel = (
      <TrainingHandoffPanel
        canManage={canManage}
        quotationNo={acceptedQuotation?.quotation_no ?? null}
        programme={opp.programme}
        participants={participants}
        hasAcceptedQuotation={!!acceptedQuotation}
        existingSchedule={existingScheduleRow ?? null}
        createHref={`/admin/schedules/new?${createParams.toString()}`}
      />
    );
  }

  return (
    <>
      <PageHead
        title={opp.title}
        subtitle={`${opp.opportunity_no} — ${opp.company_name ?? "No company on file"}`}
        action={<Link href="/admin/sales/opportunities" className="ta-btn ta-btn-outline">← Back to Opportunities</Link>}
      />

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
        <Badge status={opp.stage} />
        {leadRow && <span style={{ color: "var(--ta-muted)", fontSize: 13 }}>Source: {SOURCE_LABELS[leadRow.lead_source as "enquiry" | "proposal_request"]}</span>}
        <span style={{ color: "var(--ta-muted)", fontSize: 13 }}>
          Created {new Date(opp.created_at).toLocaleString("en-MY", { dateStyle: "medium", timeStyle: "short" })}
        </span>
        {opp.lost_reason && <span style={{ color: "var(--ta-muted)", fontSize: 13 }}>Lost reason: {opp.lost_reason.replace(/_/g, " ")}</span>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 20, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <Card title="Opportunity Information">
            <div className="ta-card-pad">
              <dl style={dl}>
                <Detail label="Source Lead" value={<Link href={`/admin/sales/leads/${opp.lead_metadata_id}`}>View original lead →</Link>} />
                <Detail label="Company" value={opp.company_name} />
                <Detail label="Contact" value={opp.contact_person} />
                <Detail label="Email" value={opp.contact_email ? <a href={`mailto:${opp.contact_email}`}>{opp.contact_email}</a> : null} />
                <Detail label="Phone" value={opp.contact_phone} />
                <Detail label="Programme" value={opp.programme} />
                <Detail label="Expected Close" value={opp.expected_close_date ? new Date(opp.expected_close_date).toLocaleDateString("en-MY", { dateStyle: "medium" } as any) : null} />
                <Detail label="Probability" value={opp.probability != null ? `${opp.probability}%` : null} />
                <Detail label="Estimated Value" value={opp.estimated_value != null ? `RM ${Number(opp.estimated_value).toLocaleString("en-MY", { minimumFractionDigits: 2 })}` : null} />
              </dl>
            </div>
          </Card>

          <Card
            title="Quotations"
            action={
              canManage && opp.stage !== "won" && opp.stage !== "lost" ? (
                <Link href={`/admin/sales/quotations/new?opportunityId=${opp.id}`} className="ta-btn ta-btn-primary ta-btn-sm">+ Create Quotation</Link>
              ) : undefined
            }
          >
            {quotationRows && quotationRows.length > 0 ? (
              <div className="ta-table-wrap">
                <table className="ta-table">
                  <thead>
                    <tr><th>Quotation No</th><th>Revision</th><th>Status</th><th>Total</th><th>Valid Until</th><th></th></tr>
                  </thead>
                  <tbody>
                    {(quotationRows as SalesQuotationRow[]).map((q) => (
                      <tr key={q.id}>
                        <td><code style={{ fontSize: 12 }}>{q.quotation_no}</code></td>
                        <td>{revisionLabel(q.revision_no)}</td>
                        <td><Badge status={q.status} /></td>
                        <td>RM {Number(q.total).toLocaleString("en-MY", { minimumFractionDigits: 2 })}</td>
                        <td>{q.valid_until ? new Date(q.valid_until).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" }) : "—"}</td>
                        <td style={{ textAlign: "right" }}><Link href={`/admin/sales/quotations/${q.id}`} className="ta-btn ta-btn-outline ta-btn-sm">View</Link></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState icon="📄" message="No quotations yet." />
            )}
          </Card>

          <LeadActivityTimeline activities={(activityRows ?? []) as SalesActivityRow[]} actorNames={actorNames} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {handoffPanel}
          <OpportunityActionsPanel
            opportunityId={opp.id}
            stage={opp.stage}
            assignedTo={opp.assigned_to}
            expectedCloseDate={opp.expected_close_date}
            probability={opp.probability}
            staff={staff}
            canManage={canManage}
          />
        </div>
      </div>
    </>
  );
}
