import Link from "next/link";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import { requireRole, requireModuleAccess } from "../../../../../../lib/auth/session";
import { isAdmin } from "../../../../../../lib/auth/rbac";
import { PageHead, Card, Badge, EmptyState, ReadErrorState } from "../../../../../../components/admin/ui";
import { LeadActivityTimeline } from "../../leads/[id]/LeadActivityTimeline";
import { formatMalaysiaDateTime } from "../../../../../../lib/date-time";
import {
  SOURCE_LABELS,
  QUOTATION_STATUS_LABELS,
  revisionLabel,
  sanitizeSearchTerm,
  type SalesOpportunityRow,
  type SalesLeadSourceKind,
  type SalesActivityRow,
  type SalesQuotationRow,
} from "../../../../../../lib/sales/crm";
import { OpportunityActionsPanel } from "./OpportunityActionsPanel";
import { TrainingHandoffPanel } from "./TrainingHandoffPanel";
import { ClientOnboardingPanel } from "./ClientOnboardingPanel";
import { matchCourseByProgramme } from "../../../schedules/options";
import type { CompanyCandidate } from "../actions";
import type { SalesTaskRow } from "../../../../../../lib/sales/crm";
import { ageLabel, expectedCloseState, formatMoney, isStalledOpportunity, latestOpportunityActivity, nextOpportunityTask, sinceActivityLabel, weightedPipelineValue } from "../../../../../../lib/sales/opportunity-pipeline";

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
  await requireModuleAccess("sales_opportunities");
  const canManage = isAdmin(profile.role);
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: opportunity, error: opportunityReadError } = await supabase.from("sales_opportunities").select("*").eq("id", id).maybeSingle();
  if (opportunityReadError) return <><PageHead title="Opportunity detail" /><ReadErrorState message="Opportunity details could not be loaded. Retry the page." /></>;
  if (!opportunity) notFound();
  const opp = opportunity as SalesOpportunityRow;

  const [leadResult, quotationsResult, activityResult, taskResult, staffResult, profilesResult] = await Promise.all([
    supabase.from("v_sales_lead_inbox").select("lead_source, source_id, status").eq("lead_metadata_id", opp.lead_metadata_id).maybeSingle(),
    supabase.from("sales_quotations").select("*").eq("opportunity_id", id).order("quotation_no", { ascending: true }).order("revision_no", { ascending: true }),
    supabase.from("sales_activity").select("*").eq("opportunity_id", id).order("created_at", { ascending: true }),
    supabase.from("sales_tasks").select("id, title, description, status, priority, due_at, assigned_to, lead_metadata_id, opportunity_id, quotation_id, created_by, completed_at, created_at, updated_at, deleted_at").eq("opportunity_id", id).is("deleted_at", null),
    supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name"),
    supabase.from("profiles").select("id, full_name"),
  ]);
  const leadRow = leadResult.data;
  const quotationRows = quotationsResult.data;
  const activityRows = activityResult.data;
  const opportunityTasks = (taskResult.data ?? []) as SalesTaskRow[];
  const signalsReadError = Boolean(activityResult.error || taskResult.error);
  const lastActivityAt = latestOpportunityActivity((activityRows ?? []) as { opportunity_id: string | null; created_at: string }[], opp.created_at);
  const nextAction = nextOpportunityTask(opportunityTasks);
  const closeState = expectedCloseState(opp.expected_close_date);
  const stalled = isStalledOpportunity(opp, opportunityTasks, (activityRows ?? []) as { opportunity_id: string | null; created_at: string }[]);
  const staff = (staffResult.data ?? []) as { id: string; full_name: string }[];
  const assignedName = opp.assigned_to ? staff.find((member) => member.id === opp.assigned_to)?.full_name ?? "Assigned staff" : "Unassigned";
  const actorNames = new Map(((profilesResult.data ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]));

  // --------------------------------------------------------------------
  // Sales CRM Phase 3 — Won Opportunity -> Training Operations handoff.
  // Only relevant once the opportunity is won; every other stage skips
  // these extra queries entirely.
  // --------------------------------------------------------------------
  let handoffPanel: ReactNode = null;
  let onboardingPanel: ReactNode = null;
  if (opp.stage === "won") {
    const acceptedQuotation = (quotationRows as SalesQuotationRow[] | null)?.find((q) => q.status === "accepted") ?? null;

    const { data: existingScheduleRow } = await supabase
      .from("course_schedules")
      .select("id, schedule_code, capacity, seats_taken, trainer_name, is_published")
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
    } else if (leadRow?.lead_source === "internal" && leadRow.source_id) {
      const { data: internalLead } = await supabase.from("sales_internal_lead_sources").select("notes").eq("id", leadRow.source_id).maybeSingle();
      objectives = internalLead?.notes ?? null;
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
        expectedParticipants={participants}
        hasAcceptedQuotation={!!acceptedQuotation}
        existingSchedule={
          existingScheduleRow
            ? {
                id: existingScheduleRow.id,
                schedule_code: existingScheduleRow.schedule_code,
                capacity: Math.max(Number(existingScheduleRow.capacity) || 0, 0),
                enrolledCount: Math.max(Number(existingScheduleRow.seats_taken) || 0, 0),
                trainerName: existingScheduleRow.trainer_name,
                isPublished: existingScheduleRow.is_published,
              }
            : null
        }
        createHref={`/admin/schedules/new?${createParams.toString()}`}
      />
    );

    // ------------------------------------------------------------------
    // Phase 4A — Client Onboarding (company linking). Matching priority:
    // 1. exact registration number -- not applicable, sales_opportunities
    //    never collects one (no such field exists on the Sales side).
    // 2. exact canonical email match against companies.email/pic_email.
    // 3. exact normalized company name -- suggestion only, same as email.
    // Never a fuzzy/substring match; ambiguity (>1 hit) is surfaced as
    // "Review required", never silently narrowed to a guess.
    // ------------------------------------------------------------------
    if (!opp.company_id) {
      const emailTerm = opp.contact_email ? sanitizeSearchTerm(opp.contact_email) : "";
      const nameTerm = opp.company_name ? sanitizeSearchTerm(opp.company_name) : "";

      const [emailMatches, nameMatches] = await Promise.all([
        emailTerm
          ? supabase
              .from("companies")
              .select("id, company_id, company_name, industry, person_in_charge")
              .is("deleted_at", null)
              .or(`email.ilike.${emailTerm},pic_email.ilike.${emailTerm}`)
          : Promise.resolve({ data: [] as CompanyCandidate[] }),
        nameTerm
          ? supabase
              .from("companies")
              .select("id, company_id, company_name, industry, person_in_charge")
              .is("deleted_at", null)
              .ilike("company_name", nameTerm)
          : Promise.resolve({ data: [] as CompanyCandidate[] }),
      ]);

      const candidates = new Map<string, CompanyCandidate>();
      for (const c of (emailMatches.data ?? []) as CompanyCandidate[]) candidates.set(c.id, c);
      for (const c of (nameMatches.data ?? []) as CompanyCandidate[]) candidates.set(c.id, c);
      const candidateList = Array.from(candidates.values());

      onboardingPanel = (
        <ClientOnboardingPanel
          opportunityId={opp.id}
          canManage={canManage}
          linkedCompany={null}
          suggested={candidateList.length === 1 ? candidateList[0] : null}
          ambiguousCount={candidateList.length}
        />
      );
    } else {
      const { data: linkedCompanyRow } = await supabase
        .from("companies")
        .select("id, company_name")
        .eq("id", opp.company_id)
        .maybeSingle();
      onboardingPanel = (
        <ClientOnboardingPanel
          opportunityId={opp.id}
          canManage={canManage}
          linkedCompany={linkedCompanyRow ?? null}
          suggested={null}
          ambiguousCount={0}
        />
      );
    }
  }

  return (
    <>
      <PageHead
        title={opp.title}
        subtitle={`${opp.opportunity_no} — ${opp.company_name ?? "No company on file"}`}
        action={!quotationsResult.error && canManage && opp.stage !== "won" && opp.stage !== "lost"
          ? <Link href={`/admin/sales/quotations/new?opportunityId=${opp.id}`} className="ta-btn ta-btn-primary ta-btn-sm">+ Create Quotation</Link>
          : <Link href={`/admin/sales/leads/${opp.lead_metadata_id}`} className="ta-btn ta-btn-outline">View Source Lead</Link>}
        secondaryAction={<Link href="/admin/sales/opportunities" className="ta-btn ta-btn-outline">← Back to Opportunities</Link>}
      />

      <div className="ta-lead-meta">
        <Badge status={opp.stage} />
        {leadRow && <span className="ta-lead-meta-time">Source: {SOURCE_LABELS[leadRow.lead_source as SalesLeadSourceKind]}</span>}
        <span className="ta-lead-meta-time">
          Created {formatMalaysiaDateTime(opp.created_at)}
        </span>
        {opp.lost_reason && <span className="ta-lead-meta-time">Lost reason: {opp.lost_reason.replace(/_/g, " ")}</span>}
      </div>

      <section className="ta-sales-summary" aria-label="Opportunity overview">
        <div className="ta-sales-summary-item"><span>Stage</span><strong><Badge status={opp.stage} /></strong></div>
        <div className="ta-sales-summary-item"><span>Estimated value</span><strong>{formatMoney(opp.estimated_value)}</strong><small>Weighted {formatMoney(weightedPipelineValue(opp.estimated_value, opp.probability))}</small></div>
        <div className="ta-sales-summary-item"><span>Owner</span><strong>{assignedName}</strong></div>
        <div className="ta-sales-summary-item"><span>Expected close</span><strong>{opp.expected_close_date ? new Date(opp.expected_close_date).toLocaleDateString("en-MY", { dateStyle: "medium" } as any) : "No date"}</strong><small>{closeState === "due_soon" ? "Due soon" : closeState === "overdue" ? "Overdue" : opp.expected_close_date ? "Upcoming" : "Not scheduled"}</small></div>
        <div className="ta-sales-summary-item"><span>Probability</span><strong>{opp.probability != null ? `${opp.probability}%` : "Not set"}</strong></div>
        <div className="ta-sales-summary-item"><span>Opportunity age</span><strong>{ageLabel(opp.created_at)}</strong><small>Last activity {activityResult.error ? "Unavailable — retry" : sinceActivityLabel(lastActivityAt, opp.created_at)}</small></div>
        <div className="ta-sales-summary-item"><span>Next action</span><strong>{taskResult.error ? "Unavailable — retry" : nextAction?.title ?? "No active task"}</strong>{!taskResult.error && nextAction?.due_at && <small>Due {formatMalaysiaDateTime(nextAction.due_at)}</small>}</div>
        <div className="ta-sales-summary-item"><span>Source Lead</span><strong><Link href={`/admin/sales/leads/${opp.lead_metadata_id}`}>View original lead →</Link></strong>{leadRow && <small>{SOURCE_LABELS[leadRow.lead_source as SalesLeadSourceKind]}</small>}</div>
        <div className="ta-sales-summary-item"><span>Indicators</span><strong>{signalsReadError ? "Unable to calculate" : stalled ? <Badge status="stalled" /> : "No stall signal"}</strong>{closeState === "overdue" && <small><Badge status="overdue" /></small>}</div>
      </section>
      {(leadResult.error || staffResult.error || profilesResult.error) && <ReadErrorState title="Some opportunity context unavailable" message="Source lead, owner, or activity names could not be fully loaded. Retry the page to refresh the relationship context." />}

      <div className="ta-lead-detail-grid">
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <Card title="Opportunity Information">
            <div className="ta-card-pad">
              <dl style={dl}>
                <Detail label="Company" value={opp.company_name} />
                <Detail label="Contact" value={opp.contact_person} />
                <Detail label="Email" value={opp.contact_email ? <a href={`mailto:${opp.contact_email}`}>{opp.contact_email}</a> : null} />
                <Detail label="Phone" value={opp.contact_phone} />
                <Detail label="Programme" value={opp.programme} />
              </dl>
            </div>
          </Card>

          <Card title="Quotations">
            {quotationsResult.error ? <ReadErrorState title="Quotation history unavailable" message="Related quotations could not be loaded. Retry the page; this is not an empty quotation history." /> : quotationRows && quotationRows.length > 0 ? (
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

          {activityResult.error ? <ReadErrorState title="Activity history unavailable" message="Opportunity activity could not be loaded. Retry the page." /> : profilesResult.error ? <ReadErrorState title="Activity names unavailable" message="Activity loaded, but actor names could not be resolved." /> : <LeadActivityTimeline activities={(activityRows ?? []) as SalesActivityRow[]} actorNames={actorNames} />}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {onboardingPanel}
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
