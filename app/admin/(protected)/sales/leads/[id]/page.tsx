import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import { requireRole, requireModuleAccess } from "../../../../../../lib/auth/session";
import { isAdmin, isSuperAdmin } from "../../../../../../lib/auth/rbac";
import { PageHead, Card, Badge, EmptyState } from "../../../../../../components/admin/ui";
import { FollowUpBadge } from "../../../../../../components/admin/sales/FollowUpBadge";
import { PRIORITY_LABELS, SOURCE_LABELS, followUpState, type SalesLeadInboxRow, type SalesActivityRow } from "../../../../../../lib/sales/crm";
import { LeadActionsPanel } from "./LeadActionsPanel";
import { LeadActivityTimeline } from "./LeadActivityTimeline";
import { formatMalaysiaDateTime } from "../../../../../../lib/date-time";
import { ageLabel, daysSinceActivityLabel, qualificationLabel, temperatureLabel, QUALIFICATION_REASON_LABELS, DISQUALIFICATION_REASON_LABELS } from "../../../../../../lib/sales/qualification";
import { checkLeadRegistrationEligibility } from "../registration-schedules";
import { setLeadAttribution } from "../actions";
import { LEAD_ATTRIBUTION_SOURCE_LABELS, LEAD_ATTRIBUTION_SOURCES, type LeadAttributionRow } from "../../../../../../lib/marketing/crm";
import type { MarketingContact } from "../../../../../../lib/supabase/database.types";

export const metadata = { title: "Lead Detail — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

interface EnquirySource {
  name: string; company: string | null; email: string; phone: string;
  enquiry_type: string; subject: string; message: string; source_page: string; created_at: string;
}
interface ProposalSource {
  company_name: string; contact_person: string; job_title: string | null; email: string; phone: string;
  industry: string; category: string; programme: string | null; participants: number | null;
  location: string | null; preferred_month: string | null; budget: string | null; objectives: string; notes: string | null; created_at: string;
}

function MarketingContactSourceDetail({ source }: { source: MarketingContact }) {
  return (
    <Card title="Original submission">
      <div className="ta-card-pad">
        <dl className="ta-kv">
          <Detail label="Contact number" value={source.contact_number} />
          <Detail label="Source" value={source.source.replace(/_/g, " ")} />
          <Detail label="Lifecycle status" value={source.status.replace(/_/g, " ")} />
          <Detail label="Consent" value={source.consent_status.replace(/_/g, " ")} />
          <Detail label="Created" value={formatMalaysiaDateTime(source.created_at)} />
        </dl>
      </div>
    </Card>
  );
}

function Detail({ label, value }: { label: string; value: any }) {
  return (
    <div style={{ display: "contents" }}>
      <dt>{label}</dt>
      <dd>{value || "—"}</dd>
    </div>
  );
}

export default async function LeadDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ attributionError?: string; attributionSaved?: string }> }) {
  const profile =   await requireRole("editor");
  await requireModuleAccess("sales_leads");
  const canManage = isAdmin(profile.role);
  const superAdmin = isSuperAdmin(profile.role);
  const { id } = await params;
  const sp = await searchParams;
  const supabase = await createSupabaseServerClient();

  const { data: lead } = await supabase.from("v_sales_lead_inbox").select("*").eq("lead_metadata_id", id).maybeSingle();
  if (!lead) notFound();
  const row = lead as SalesLeadInboxRow;

  const [sourceResult, activityResult, attributionResult, campaignsResult, staffResult, profilesResult, opportunityResult, moduleAccessResult, nextActionResult, qualificationResult] = await Promise.all([
    row.lead_source === "enquiry"
      ? supabase.from("enquiries").select("*").eq("id", row.source_id).maybeSingle()
      : row.lead_source === "proposal_request"
        ? supabase.from("proposal_requests").select("*").eq("id", row.source_id).maybeSingle()
        : row.lead_source === "marketing_contact"
          ? supabase.from("marketing_contacts").select("*").eq("id", row.source_id).maybeSingle()
          : Promise.resolve({ data: null }),
    supabase.from("sales_activity").select("*").eq("lead_metadata_id", id).order("created_at", { ascending: true }),
    supabase.from("sales_lead_attributions").select("*, marketing_campaigns(name)").eq("lead_metadata_id", id).maybeSingle(),
    supabase.from("marketing_campaigns").select("id, name, status").neq("status", "archived").order("name"),
    supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name"),
    supabase.from("profiles").select("id, full_name"),
    supabase.from("sales_opportunities").select("id, opportunity_no").eq("lead_metadata_id", id).maybeSingle(),
    supabase.rpc("get_my_module_access"),
    supabase
      .from("sales_tasks")
      .select("id, title, status, priority, due_at")
      .eq("lead_metadata_id", id)
      .is("deleted_at", null)
      .not("status", "in", "(completed,cancelled)")
      .order("due_at", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase.from("sales_lead_metadata").select("qualification_status, temperature, qualification_reason, disqualification_reason, qualification_changed_at, qualification_changed_by, created_at").eq("id", id).maybeSingle(),
  ]);

  const source = sourceResult.data as EnquirySource | ProposalSource | MarketingContact | null;
  const activityRows = (activityResult.data ?? []) as Array<{ created_at: string; [key: string]: unknown }>;
  const attributionError = attributionResult.error;
  const campaignsError = campaignsResult.error;
  const attribution = attributionResult.data as (LeadAttributionRow & { marketing_campaigns?: { name: string } | null }) | null;
  const campaignOptions = (campaignsResult.data ?? []) as { id: string; name: string; status: string }[];
  const staff = (staffResult.data ?? []) as { id: string; full_name: string }[];
  const actorNames = new Map(((profilesResult.data ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]));
  const existingOpportunity = opportunityResult.data;
  const nextAction = nextActionResult.data as { id: string; title: string; status: string; priority: string; due_at: string | null } | null;
  const qualification = qualificationResult.data as { qualification_status: string; temperature: string | null; qualification_reason: string | null; disqualification_reason: string | null; qualification_changed_at: string | null; qualification_changed_by: string | null; created_at: string } | null;
  const lastActivityAt = (activityRows ?? []).reduce<string | null>((latest, activity) => !latest || activity.created_at > latest ? activity.created_at : latest, null);

  const moduleAccess = moduleAccessResult.data;
  const modules = Array.isArray(moduleAccess) ? moduleAccess.map((m: { module_key: string }) => m.module_key) : [];
  const canRegister = modules.includes("sales_leads") && modules.includes("participants") && modules.includes("schedules");
  const registrationEligibility = checkLeadRegistrationEligibility({ status: row.status, is_test: row.is_test });

  return (
    <>
      <PageHead
        title={row.contact_name ?? "Lead"}
        subtitle={`${SOURCE_LABELS[row.lead_source]} — ${row.company ?? "No company given"}`}
        action={<Link href="/admin/sales/leads" className="ta-btn ta-btn-outline">← Back to Leads</Link>}
      />

      <div className="ta-lead-meta">
        <Badge status={row.status} />
        {row.is_test && <span className="ta-badge-pill" style={{ background: "#f4f5f7", color: "#667085" }}>Test/Demo</span>}
        <FollowUpBadge state={followUpState(row.follow_up_at, row.status)} />
        <span className="ta-lead-meta-time">
          Created {formatMalaysiaDateTime(row.created_at)}
        </span>
        {row.lost_reason && <span className="ta-lead-meta-time">Lost reason: {row.lost_reason.replace(/_/g, " ")}</span>}
      </div>

      <div className="ta-lead-detail-grid">
        <div className="ta-lead-detail-main">
          <Card title="Contact">
            <div className="ta-card-pad">
              <dl className="ta-kv">
                <Detail label="Name" value={row.contact_name} />
                <Detail label="Company" value={row.company} />
                <Detail label="Email" value={row.email ? <a href={`mailto:${row.email}`}>{row.email}</a> : null} />
                <Detail label="Phone" value={row.phone} />
              </dl>
            </div>
          </Card>

          <Card title="Marketing attribution">
            {(attributionError || campaignsError) && <div className="ta-alert ta-alert-error">Unable to load marketing attribution options. Please try again.</div>}
            {sp.attributionError && <div className="ta-alert ta-alert-error" role="alert">{sp.attributionError}</div>}
            {sp.attributionSaved && <div className="ta-alert ta-alert-success" role="status">Marketing attribution saved.</div>}
            <form action={setLeadAttribution.bind(null, id)} className="ta-form-pad">
              <div className="ta-field-row">
                <label className="ta-field">Source<select name="source" defaultValue={attribution?.source ?? "website"}>{LEAD_ATTRIBUTION_SOURCES.map((source) => <option key={source} value={source}>{LEAD_ATTRIBUTION_SOURCE_LABELS[source]}</option>)}</select></label>
                <label className="ta-field">Campaign<select name="campaign_id" defaultValue={attribution?.campaign_id ?? ""}><option value="">No campaign</option>{campaignOptions.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select></label>
              </div>
              <div className="ta-field-row">
                {(["utm_source", "utm_medium", "utm_campaign"] as const).map((field) => <label key={field} className="ta-field">{field.replace("utm_", "UTM ")}<input name={field} defaultValue={attribution?.[field] ?? ""} maxLength={160} /></label>)}
              </div>
              <div className="ta-field-row">
                {(["utm_content", "utm_term"] as const).map((field) => <label key={field} className="ta-field">{field.replace("utm_", "UTM ")}<input name={field} defaultValue={attribution?.[field] ?? ""} maxLength={160} /></label>)}
              </div>
              <label className="ta-field">Notes<textarea name="notes" rows={2} defaultValue={attribution?.notes ?? ""} /></label>
              <div><button type="submit" className="ta-btn ta-btn-outline ta-btn-sm">Save attribution</button>{attribution?.marketing_campaigns?.name && <span className="ta-muted-sub" style={{ marginLeft: 10 }}>Currently linked to {attribution.marketing_campaigns.name}</span>}</div>
            </form>
          </Card>

          {row.lead_source === "enquiry" && source ? (
            <EnquiryDetail source={source as EnquirySource} />
          ) : row.lead_source === "proposal_request" && source ? (
            <ProposalDetail source={source as ProposalSource} />
          ) : row.lead_source === "marketing_contact" && source ? (
            <MarketingContactSourceDetail source={source as MarketingContact} />
          ) : (
            <Card title="Original submission">
              <EmptyState message="The original submission record could not be found — it may have been removed." />
            </Card>
          )}

          <LeadActivityTimeline activities={(activityRows ?? []) as unknown as SalesActivityRow[]} actorNames={actorNames} />
        </div>

        <div className="ta-lead-detail-side">
          {canRegister && (
            <Card title="Registration">
              <div className="ta-card-pad ta-stack">
                {registrationEligibility.eligible ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <Link href={`/admin/sales/leads/${id}/personal-registration`} className="ta-btn ta-btn-outline ta-btn-sm">
                      Personal Registration
                    </Link>
                    <Link href={`/admin/sales/leads/${id}/company-registration`} className="ta-btn ta-btn-outline ta-btn-sm">
                      Company Registration
                    </Link>
                  </div>
                ) : (
                  <p className="ta-alert ta-alert-error" style={{ margin: 0, fontSize: 13 }} role="alert">
                    {registrationEligibility.reason}
                  </p>
                )}
              </div>
            </Card>
          )}

          <Card title="Next Action">
            <div className="ta-card-pad ta-stack">
              {nextAction ? (
                <>
                  <strong>{nextAction.title}</strong>
                  <span className="ta-muted-sub">
                    {nextAction.due_at ? `Due ${formatMalaysiaDateTime(nextAction.due_at)}` : "No due date"} · {nextAction.status.replace(/_/g, " ")}
                  </span>
                  <Link href={`/admin/sales/tasks/${nextAction.id}`} className="ta-btn ta-btn-outline ta-btn-sm">View / update task</Link>
                </>
              ) : (
                <>
                  <span className="ta-muted-sub">No active next action.</span>
                  <Link href={`/admin/sales/tasks/new?leadId=${id}`} className="ta-btn ta-btn-outline ta-btn-sm">Add task</Link>
                </>
              )}
            </div>
          </Card>

          <Card title="Sales Qualification">
            <div className="ta-card-pad">
              <dl className="ta-kv">
                <Detail label="Qualification" value={qualificationLabel(qualification?.qualification_status)} />
                <Detail label="Reason" value={qualification?.qualification_status === "qualified" ? QUALIFICATION_REASON_LABELS[qualification.qualification_reason as keyof typeof QUALIFICATION_REASON_LABELS] : DISQUALIFICATION_REASON_LABELS[qualification?.disqualification_reason as keyof typeof DISQUALIFICATION_REASON_LABELS]} />
                <Detail label="Temperature" value={temperatureLabel(qualification?.temperature)} />
                <Detail label="Priority" value={PRIORITY_LABELS[row.priority]} />
                <Detail label="Lead age" value={ageLabel(qualification?.created_at ?? row.created_at)} />
                <Detail label="Last activity" value={daysSinceActivityLabel(lastActivityAt)} />
              </dl>
            </div>
          </Card>

          <LeadActionsPanel
            leadMetadataId={row.lead_metadata_id}
            status={row.status}
            assignedTo={row.assigned_to}
            followUpAt={row.follow_up_at}
            priority={row.priority}
            staff={staff}
            canManage={canManage}
            existingOpportunity={existingOpportunity ?? null}
            defaultOpportunityTitle={row.subject ?? undefined}
            isSuperAdmin={superAdmin}
            isTest={row.is_test}
            qualificationStatus={qualification?.qualification_status ?? "pending"}
            temperature={qualification?.temperature ?? null}
            qualificationReason={qualification?.qualification_reason ?? null}
            disqualificationReason={qualification?.disqualification_reason ?? null}
          />
        </div>
      </div>
    </>
  );
}

function EnquiryDetail({ source }: { source: EnquirySource }) {
  return (
    <Card title="Original Enquiry">
      <div className="ta-card-pad">
        <dl className="ta-kv">
          <Detail label="Enquiry Type" value={source.enquiry_type} />
          <Detail label="Subject" value={source.subject} />
          <Detail label="Submitted From" value={source.source_page === "homepage" ? "Homepage contact form" : "Contact page"} />
        </dl>
        <h4 className="ta-subhead">Message</h4>
        <p className="ta-pre-wrap">{source.message}</p>
      </div>
    </Card>
  );
}

function ProposalDetail({ source }: { source: ProposalSource }) {
  return (
    <Card title="Original Proposal Request">
      <div className="ta-card-pad">
        <dl className="ta-kv">
          <Detail label="Job Title" value={source.job_title} />
          <Detail label="Industry" value={source.industry} />
          <Detail label="Training Category" value={source.category} />
          <Detail label="Specific Programme" value={source.programme} />
          <Detail label="Participants" value={source.participants} />
          <Detail label="Location" value={source.location} />
          <Detail label="Preferred Month" value={source.preferred_month} />
          <Detail label="Budget" value={source.budget} />
        </dl>
        <h4 className="ta-subhead">Training Objectives</h4>
        <p className="ta-pre-wrap">{source.objectives}</p>
        {source.notes && (
          <>
            <h4 className="ta-subhead">Additional Notes</h4>
            <p className="ta-pre-wrap">{source.notes}</p>
          </>
        )}
      </div>
    </Card>
  );
}
