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
  sanitizeSearchTerm,
  type SalesOpportunityRow,
  type SalesActivityRow,
  type SalesQuotationRow,
} from "../../../../../../lib/sales/crm";
import { OpportunityActionsPanel } from "./OpportunityActionsPanel";
import { TrainingHandoffPanel } from "./TrainingHandoffPanel";
import { ClientOnboardingPanel } from "./ClientOnboardingPanel";
import { matchCourseByProgramme } from "../../../schedules/options";
import type { CompanyCandidate } from "../actions";

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
          {onboardingPanel}
          {handoffPanel}
          <OpportunityActionsPanel
            opportunityId={opp.id}
            stage={opp.stage}
            assignedTo={opp.assigned_to}
            expectedCloseDate={opp.expected_close_date}
            probability={opp.probability}
            title={opp.title}
            programme={opp.programme}
            estimatedValue={opp.estimated_value}
            staff={staff}
            canManage={canManage}
          />
        </div>
      </div>
    </>
  );
}
