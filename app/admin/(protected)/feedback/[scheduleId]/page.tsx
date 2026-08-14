import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { requireRole } from "../../../../../lib/auth/session";
import { PageHead, Card, StatCard, EmptyState } from "../../../../../components/admin/ui";
import { generateFeedbackLinks } from "../actions";
import { FeedbackLinkCard, type FeedbackLinkRow } from "./FeedbackLinkCard";
import { siteOrigin } from "../../../../../lib/site-origin";

export const metadata = { title: "Schedule Feedback — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

export default async function ScheduleFeedbackPage({ params }: { params: Promise<{ scheduleId: string }> }) {
  await requireRole("editor");
  const { scheduleId } = await params;
  const supabase = await createSupabaseServerClient();
  const origin = await siteOrigin();

  const { data: schedule } = await supabase
    .from("course_schedules")
    .select("id, schedule_code, start_date, end_date, venue, trainer_name, courses(title, course_name)")
    .eq("id", scheduleId)
    .single();
  if (!schedule) notFound();
  const courseName = (schedule as any).courses?.title ?? (schedule as any).courses?.course_name ?? "—";

  const [{ data: stats }, { data: feedbackRows }] = await Promise.all([
    supabase.rpc("feedback_anonymous_stats", { p_schedule_id: scheduleId }),
    supabase
      .from("participant_feedback")
      .select("id, status, token, participants(id, full_name, participant_id, company)")
      .eq("schedule_id", scheduleId)
      .order("created_at", { ascending: true }),
  ]);

  const stat = stats?.[0] as
    | { total_eligible: number; responses: number; response_rate: number; avg_overall: number; nps: number }
    | undefined;

  const links: FeedbackLinkRow[] = ((feedbackRows ?? []) as any[]).map((r) => ({
    id: r.id,
    participantName: r.participants?.full_name ?? "—",
    participantCode: r.participants?.participant_id ?? null,
    company: r.participants?.company ?? null,
    status: r.status,
    url: `${origin}/feedback/${r.token}`,
  }));

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

      <div className="ta-grid cols-3" style={{ marginBottom: 22 }}>
        <StatCard label="Responses" value={stat?.responses ?? 0} icon="✉" />
        <StatCard label="Eligible Participants" value={stat?.total_eligible ?? 0} icon="👥" />
        <StatCard label="Response Rate" value={stat?.response_rate != null ? `${stat.response_rate}%` : "—"} icon="📈" />
        <StatCard label="Overall Score" value={stat?.avg_overall != null ? `${stat.avg_overall} / 5` : "—"} icon="⭐" />
        <StatCard label="NPS" value={stat?.nps ?? "—"} icon="👍" />
        <div>
          <form action={generateFeedbackLinks.bind(null, scheduleId)}>
            <button className="ta-btn ta-btn-primary" style={{ width: "100%" }}>Generate Feedback Links</button>
          </form>
        </div>
      </div>

      <Card title={`Participant Feedback Links (${links.length})`}>
        <div className="ta-card-pad">
          {links.length > 0 ? (
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
