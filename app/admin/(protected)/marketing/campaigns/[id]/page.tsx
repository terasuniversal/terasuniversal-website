import Link from "next/link";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import { requireModuleAccess } from "../../../../../../lib/auth/session";
import { PageHead, Card, Badge } from "../../../../../../components/admin/ui";
import { CHANNEL_LABELS } from "../../../../../../lib/marketing/campaigns";
import type { MarketingCampaign, MarketingCampaignStatus } from "../../../../../../lib/supabase/database.types";
import { activateCampaign, completeCampaign, archiveCampaign } from "../actions";

export const metadata = { title: "Campaign Detail — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div style={{ display: "contents" }}>
      <dt>{label}</dt>
      <dd>{value || "—"}</dd>
    </div>
  );
}

function formatDate(d: string | null) {
  return d ? new Date(d).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" }) : null;
}
function formatDateTime(d: string) {
  return new Date(d).toLocaleString("en-MY", { dateStyle: "medium", timeStyle: "short" });
}
function formatMoney(v: number | null) {
  return v != null ? `RM ${Number(v).toLocaleString("en-MY", { minimumFractionDigits: 2 })}` : null;
}

/**
 * The one valid next lifecycle step for a given status, matching the locked
 * linear order (draft -> active -> completed -> archived) exactly. `null`
 * for `archived` — it's terminal, and there is no delete action (Step 2C
 * scope: "No DELETE").
 */
const NEXT_ACTION: Record<MarketingCampaignStatus, { label: string; action: (id: string) => Promise<void> } | null> = {
  draft: { label: "Activate", action: activateCampaign },
  active: { label: "Complete", action: completeCampaign },
  completed: { label: "Archive", action: archiveCampaign },
  archived: null,
};

/**
 * Read-only detail + Step 2C quick actions (Edit, and the single valid
 * lifecycle transition for the current status). No lead/opportunity counts,
 * revenue, or ROAS — those require Attribution (Phase 1C) / Dashboard
 * (later phase), neither of which is live yet.
 */
export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireModuleAccess("marketing_campaigns");
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: campaign, error } = await supabase.from("marketing_campaigns").select("*").eq("id", id).maybeSingle();
  if (error) {
    return (
      <>
        <PageHead title="Campaign" subtitle="Could not load this campaign." />
        <div className="ta-alert ta-alert-error">{error.message}</div>
      </>
    );
  }
  if (!campaign) notFound();
  const c = campaign as MarketingCampaign;

  let ownerName: string | null = null;
  if (c.owner_id) {
    const { data: owner, error: ownerError } = await supabase.from("profiles").select("full_name").eq("id", c.owner_id).maybeSingle();
    if (ownerError) console.error("marketing_campaigns detail: failed to load owner name", { message: ownerError.message });
    ownerName = owner?.full_name ?? null;
  }
  let courseTitle: string | null = null;
  if (c.course_id) {
    const { data: course, error: courseError } = await supabase.from("courses").select("title").eq("id", c.course_id).maybeSingle();
    if (courseError) console.error("marketing_campaigns detail: failed to load course title", { message: courseError.message });
    courseTitle = course?.title ?? null;
  }

  const period = c.start_date || c.end_date ? `${formatDate(c.start_date) ?? "—"} – ${formatDate(c.end_date) ?? "—"}` : null;
  const nextAction = NEXT_ACTION[c.status];

  return (
    <>
      <PageHead
        title={c.name}
        subtitle={c.campaign_number}
        action={
          <div style={{ display: "flex", gap: 8 }}>
            <Link href="/admin/marketing/campaigns" className="ta-btn ta-btn-outline">
              ← Back to Campaigns
            </Link>
            <Link href={`/admin/marketing/campaigns/${c.id}/edit`} className="ta-btn ta-btn-primary">
              Edit Campaign
            </Link>
          </div>
        }
      />

      <div className="ta-lead-meta">
        <Badge status={c.status} />
        {nextAction && (
          <form action={nextAction.action.bind(null, c.id)}>
            <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm">
              {nextAction.label}
            </button>
          </form>
        )}
        <span className="ta-lead-meta-time">Created {formatDateTime(c.created_at)}</span>
      </div>

      <Card title="Campaign Information">
        <div className="ta-card-pad">
          <dl className="ta-kv">
            <Detail label="Campaign Number" value={c.campaign_number} />
            <Detail label="Channel" value={CHANNEL_LABELS[c.channel]} />
            <Detail label="Status" value={<Badge status={c.status} />} />
            <Detail label="Period" value={period} />
            <Detail label="Budget" value={formatMoney(c.budget)} />
            <Detail label="Actual Spend" value={formatMoney(c.actual_spend)} />
            <Detail label="Owner" value={ownerName} />
            <Detail label="Course" value={courseTitle} />
            <Detail label="UTM Campaign" value={c.utm_campaign} />
            <Detail label="Notes" value={c.notes} />
            <Detail label="Created" value={formatDateTime(c.created_at)} />
            <Detail label="Last Updated" value={formatDateTime(c.updated_at)} />
          </dl>
        </div>
      </Card>
    </>
  );
}
