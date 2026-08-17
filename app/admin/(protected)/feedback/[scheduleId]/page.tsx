import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient, createSupabaseServiceClient } from "../../../../../lib/supabase/server";
import { requireRole, requireModuleAccess } from "../../../../../lib/auth/session";
import { PageHead, Card, StatCard, EmptyState } from "../../../../../components/admin/ui";
import { FeedbackLinkCard, type FeedbackLinkRow } from "./FeedbackLinkCard";
import { GenerateLinksForm } from "./GenerateLinksForm";
import { ClassFeedbackQrCard } from "./ClassFeedbackQrCard";
import { canonicalSiteOrigin } from "../../../../../lib/site-origin";

export const metadata = { title: "Schedule Feedback — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

export default async function ScheduleFeedbackPage({ params }: { params: Promise<{ scheduleId: string }> }) {
  await requireRole("editor");
  await requireModuleAccess("feedback");
  const { scheduleId } = await params;
  const supabase = await createSupabaseServerClient();
  const origin = await canonicalSiteOrigin();

  const { data: schedule } = await supabase
    .from("course_schedules")
    .select("id, schedule_code, start_date, end_date, venue, trainer_name, courses(title, course_name)")
    .eq("id", scheduleId)
    .single();
  if (!schedule) notFound();
  const courseName = (schedule as any).courses?.title ?? (schedule as any).courses?.course_name ?? "—";

  const service = createSupabaseServiceClient();
  const [{ data: stats, error: statsError }, { data: feedbackRows, error: feedbackError }, { data: classLink }] = await Promise.all([
    supabase.rpc("feedback_anonymous_stats" as never, { p_schedule_id: scheduleId } as never),
    supabase
      .from("participant_feedback")
      .select("id, status, token, participants(id, full_name, participant_id, company)")
      .eq("schedule_id", scheduleId)
      .order("created_at", { ascending: true }),
    service
      .from("feedback_schedule_links")
      .select("public_token, is_active")
      .eq("schedule_id", scheduleId)
      .maybeSingle(),
  ]);

  if (statsError) {
    console.error("ScheduleFeedbackPage: feedback_anonymous_stats failed", { scheduleId, code: statsError.code, message: statsError.message });
  }
  if (feedbackError) {
    console.error("ScheduleFeedbackPage: participant_feedback select failed", { scheduleId, code: feedbackError.code, message: feedbackError.message });
  }

  const statsUnavailable = Boolean(statsError);
  const linksUnavailable = Boolean(feedbackError);

  const stat = !statsUnavailable
    ? ((stats as any)?.[0] as
        | { total_eligible: number; responses: number; response_rate: number; avg_overall: number; nps: number }
        | undefined)
    : undefined;

  const links: FeedbackLinkRow[] = !linksUnavailable
    ? ((feedbackRows ?? []) as any[]).map((r) => ({
        id: r.id,
        participantName: r.participants?.full_name ?? "—",
        participantCode: r.participants?.participant_id ?? null,
        company: r.participants?.company ?? null,
        status: r.status,
        url: `${origin}/feedback/${r.token}`,
      }))
    : [];

  return (
    <>
      <PageHead
        title="Participant Feedback"
        subtitle={`${courseName} — ${(schedule as any).schedule_code ?? ""}`}
        action={
          <div style={{ display: "flex", gap: 8 }}>
            <Link href="/admin/feedback" className="ta-btn ta-btn-outline">← Dashboard</Link>
            <Link href={`/admin/feedback?schedule=${scheduleId}`} className="ta-btn ta-btn-outline">Open Dashboard</Link>
          </div>
        }
      />

      {statsUnavailable ? (
        <div className="ta-alert ta-alert-error" style={{ marginBottom: 22 }} role="alert">
          Feedback data is currently unavailable.
        </div>
      ) : (
        <div className="ta-grid cols-3" style={{ marginBottom: 22 }}>
          <StatCard label="Responses" value={stat?.responses ?? 0} icon="✉" />
          <StatCard label="Eligible Participants" value={stat?.total_eligible ?? 0} icon="👥" />
          <StatCard label="Response Rate" value={stat?.response_rate != null ? `${stat.response_rate}%` : "—"} icon="📈" />
          <StatCard label="Overall Score" value={stat?.avg_overall != null ? `${stat.avg_overall} / 5` : "—"} icon="⭐" />
          <StatCard label="NPS" value={stat?.nps ?? "—"} icon="👍" />
        </div>
      )}

      <div style={{ maxWidth: 320, marginBottom: 22 }}>
        <GenerateLinksForm scheduleId={scheduleId} />
      </div>

      <ClassFeedbackQrCard
        scheduleId={scheduleId}
        courseName={courseName}
        scheduleCode={(schedule as any).schedule_code ?? ""}
        baseUrl={`${origin}/feedback/s/`}
        initialPublicToken={classLink?.is_active ? classLink.public_token : null}
      />

      <Card title={`Participant Feedback Links (${links.length})`}>
        <div className="ta-card-pad">
          {linksUnavailable ? (
            <EmptyState icon="⚠" message="Feedback data is currently unavailable." />
          ) : links.length > 0 ? (
            <FeedbackLinkCard links={links} baseUrl={`${origin}/feedback/`} />
          ) : (
            <EmptyState
              icon="✉"
              message="No feedback links yet. Click 'Generate Feedback Links' to create one per enrolled participant."
            />
          )}
        </div>
      </Card>
    </>
  );
}
