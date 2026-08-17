import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import { requireRole, requireModuleAccess } from "../../../../../../lib/auth/session";
import { isAdmin, isSuperAdmin } from "../../../../../../lib/auth/rbac";
import { PageHead, Card, Badge, EmptyState } from "../../../../../../components/admin/ui";
import { FollowUpBadge } from "../../../../../../components/admin/sales/FollowUpBadge";
import { SOURCE_LABELS, followUpState, type SalesLeadInboxRow, type SalesActivityRow } from "../../../../../../lib/sales/crm";
import { LeadActionsPanel } from "./LeadActionsPanel";
import { LeadActivityTimeline } from "./LeadActivityTimeline";
import { formatMalaysiaDateTime } from "../../../../../../lib/date-time";

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

function Detail({ label, value }: { label: string; value: any }) {
  return (
    <div style={{ display: "contents" }}>
      <dt>{label}</dt>
      <dd>{value || "—"}</dd>
    </div>
  );
}

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const profile =   await requireRole("editor");
  await requireModuleAccess("sales_leads");
  const canManage = isAdmin(profile.role);
  const superAdmin = isSuperAdmin(profile.role);
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: lead } = await supabase.from("v_sales_lead_inbox").select("*").eq("lead_metadata_id", id).maybeSingle();
  if (!lead) notFound();
  const row = lead as SalesLeadInboxRow;

  const sourceTable = row.lead_source === "enquiry" ? "enquiries" : "proposal_requests";
  const { data: source } = await supabase.from(sourceTable).select("*").eq("id", row.source_id).maybeSingle();

  const { data: activityRows } = await supabase
    .from("sales_activity")
    .select("*")
    .eq("lead_metadata_id", id)
    .order("created_at", { ascending: true });

  const { data: staffRows } = await supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name");
  const staff = (staffRows ?? []) as { id: string; full_name: string }[];

  const { data: allProfiles } = await supabase.from("profiles").select("id, full_name");
  const actorNames = new Map(((allProfiles ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]));

  const { data: existingOpportunity } = await supabase
    .from("sales_opportunities")
    .select("id, opportunity_no")
    .eq("lead_metadata_id", id)
    .maybeSingle();

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

          {row.lead_source === "enquiry" && source ? (
            <EnquiryDetail source={source as EnquirySource} />
          ) : row.lead_source === "proposal_request" && source ? (
            <ProposalDetail source={source as ProposalSource} />
          ) : (
            <Card title="Original submission">
              <EmptyState message="The original submission record could not be found — it may have been removed." />
            </Card>
          )}

          <LeadActivityTimeline activities={(activityRows ?? []) as SalesActivityRow[]} actorNames={actorNames} />
        </div>

        <div className="ta-lead-detail-side">
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
