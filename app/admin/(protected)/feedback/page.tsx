import Link from "next/link";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { requireRole, requireModuleAccess } from "../../../../lib/auth/session";
import { PageHead, Card, StatCard, EmptyState } from "../../../../components/admin/ui";

export const metadata = { title: "Feedback Dashboard — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

const CATEGORY_QUESTIONS = [
  { q: "q1", label: "Course content" },
  { q: "q2", label: "Training materials" },
  { q: "q3", label: "Practical training" },
  { q: "q4", label: "Trainer subject knowledge" },
  { q: "q5", label: "Trainer clarity" },
  { q: "q6", label: "Registration process" },
  { q: "q7", label: "Training venue" },
  { q: "q8", label: "Training equipment" },
  { q: "q9", label: "Food / refreshments" },
  { q: "q10", label: "Overall satisfaction" },
];

export default async function FeedbackDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ schedule?: string }>;
}) {
  await requireRole("editor");
  await requireModuleAccess("feedback");
  const sp = await searchParams;
  const scheduleId = sp.schedule ?? "";

  const supabase = await createSupabaseServerClient();
  const scoped = (q: any) => (scheduleId ? q.eq("schedule_id", scheduleId) : q);

  const [
    { count: responses, error: responsesError },
    { count: eligible, error: eligibleError },
    { data: aggRows, error: aggRowsError },
    { count: openIssues, error: openIssuesError },
    { count: openActions, error: openActionsError },
  ] = await Promise.all([
    scoped(supabase.from("participant_feedback").select("id", { count: "exact", head: true }).eq("status", "submitted")),
    scoped(
      supabase
        .from("schedule_participants")
        .select("participant_id, participants!inner(id)", { count: "exact", head: true })
        .is("deleted_at", null)
        .neq("registration_status", "cancelled")
        .is("participants.deleted_at", null)
    ),
    scoped(
      supabase
        .from("participant_feedback")
        .select(
          "status, q1_score, q2_score, q3_score, q4_score, q5_score, q6_score, q7_score, q8_score, q9_score, q10_score, nps, liked_most, improve, submitted_at"
        )
        .eq("status", "submitted")
        .order("submitted_at", { ascending: false })
    ),
    scoped(supabase.from("feedback_issues").select("id", { count: "exact", head: true }).not("status", "in", "(resolved,closed)")),
    scoped(
      supabase
        .from("feedback_improvement_actions")
        .select("id", { count: "exact", head: true })
        .not("status", "in", "(resolved,verified,closed)")
    ),
  ]);

  const dataUnavailable = Boolean(
    responsesError || eligibleError || aggRowsError || openIssuesError || openActionsError
  );
  if (dataUnavailable) {
    console.error("FeedbackDashboardPage: one or more feedback queries failed", {
      scheduleId: scheduleId || null,
      responsesError: responsesError?.message,
      eligibleError: eligibleError?.message,
      aggRowsError: aggRowsError?.message,
      openIssuesError: openIssuesError?.message,
      openActionsError: openActionsError?.message,
    });
  }

  const rows = dataUnavailable ? [] : ((aggRows ?? []) as any[]);
  const submitted = rows.filter((r) => r.status === "submitted");
  const responseCount = responses ?? 0;
  const eligibleCount = eligible ?? 0;
  const responseRate = eligibleCount > 0 ? Math.round((responseCount / eligibleCount) * 1000) / 10 : 0;
  const avg = (field: string) =>
    submitted.length
      ? Math.round((submitted.reduce((s, r) => s + Number(r[field] ?? 0), 0) / submitted.length) * 100) / 100
      : null;

  const categoryAverages = CATEGORY_QUESTIONS.map(({ q, label }) => ({ label, value: avg(`${q}_score`) })).filter(
    (c): c is { label: string; value: number } => c.value !== null
  );
  const overall = avg("q10_score") ?? (categoryAverages.length ? categoryAverages.reduce((s, c) => s + c.value, 0) / categoryAverages.length : null);
  const lowest = [...categoryAverages].sort((a, b) => a.value - b.value).slice(0, 3);

  const npsResponses = submitted.filter((r) => r.nps !== null).length;
  const promoters = submitted.filter((r) => r.nps >= 9).length;
  const detractors = submitted.filter((r) => r.nps <= 6).length;
  const nps = npsResponses ? Math.round(((promoters - detractors) / npsResponses) * 1000) / 10 : null;

  const latestComments = submitted.filter((c: any) => (c.liked_most || c.improve) && c.submitted_at).slice(0, 8);

  return (
    <div className="ta-sales">
      <PageHead
        title="Feedback Dashboard"
        subtitle="Participant feedback across training schedules — real database data only."
        action={
          <div style={{ display: "flex", gap: 8 }}>
            <Link href="/admin/feedback/responses" className="ta-btn ta-btn-outline">Responses</Link>
            <Link href="/admin/feedback/issues" className="ta-btn ta-btn-outline">Issues</Link>
            <Link href="/admin/feedback/actions" className="ta-btn ta-btn-outline">Improvement Actions</Link>
          </div>
        }
      />

      <form className="ta-toolbar">
        <label style={{ fontSize: 12, fontWeight: 700, color: "var(--ta-muted)" }}>Schedule
          <select name="schedule" defaultValue={scheduleId} className="ta-filter-select" aria-label="Filter by schedule" style={{ marginLeft: 8, fontWeight: 500 }}>
            <option value="">All schedules</option>
            <ScheduleOptions supabase={supabase} />
          </select>
        </label>
        <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm">Apply</button>
        {scheduleId && <Link className="ta-btn ta-btn-outline ta-btn-sm" href="/admin/feedback">Reset</Link>}
      </form>

      {dataUnavailable ? (
        <div className="ta-alert ta-alert-error" role="alert">
          Feedback data is currently unavailable.
        </div>
      ) : (
        <>
          <div className="ta-grid cols-3" style={{ marginBottom: 22 }}>
            <StatCard label="Responses" value={responseCount} icon="✉" />
            <StatCard label="Eligible Participants" value={eligibleCount} icon="👥" />
            <StatCard label="Response Rate" value={`${responseRate}%`} icon="📈" />
            <StatCard label="Overall Score" value={overall ? `${overall} / 5` : "—"} icon="⭐" />
            <StatCard label="NPS" value={nps ?? "—"} icon="👍" context={nps !== null ? `${promoters} promoters · ${detractors} detractors` : undefined} />
            <StatCard label="Open Issues" value={openIssues ?? 0} icon="🚩" href="/admin/feedback/issues" />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, alignItems: "start", marginBottom: 18 }}>
            <Card title="Scores by Category">
              <div className="ta-card-pad">
                {categoryAverages.length ? (
                  <div style={{ display: "grid", gap: 10 }}>
                    {categoryAverages.map((c) => (
                      <div key={c.label} style={{ display: "grid", gridTemplateColumns: "190px 1fr 42px", gap: 10, alignItems: "center" }}>
                        <span style={{ fontSize: 12.5, color: "var(--ta-ink)" }}>{c.label}</span>
                        <div className="ta-bar"><span style={{ width: `${(c.value / 5) * 100}%` }} /></div>
                        <span style={{ fontSize: 12.5, fontWeight: 800, color: "var(--ta-navy)", textAlign: "right" }}>{c.value}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState message="No submitted feedback yet." />
                )}
              </div>
            </Card>

            <div style={{ display: "grid", gap: 18 }}>
              <Card title="Lowest Scoring Categories">
                <div className="ta-card-pad">
                  {lowest.length ? (
                    <ol style={{ margin: 0, paddingLeft: 18 }}>
                      {lowest.map((c) => (
                        <li key={c.label} style={{ marginBottom: 8, fontSize: 13.5, color: "var(--ta-ink)" }}>
                          <strong>{c.label}</strong> — {c.value} / 5
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <EmptyState message="No submitted feedback yet." />
                  )}
                </div>
              </Card>

              <Card title="Open Improvement Actions">
                <div className="ta-card-pad">
                  <div style={{ fontSize: 34, fontWeight: 800, color: "var(--ta-navy)" }}>{openActions ?? 0}</div>
                  <Link href="/admin/feedback/actions" className="ta-btn ta-btn-outline ta-btn-sm" style={{ marginTop: 10 }}>View actions →</Link>
                </div>
              </Card>
            </div>
          </div>

          <Card title="Latest Comments">
            <div className="ta-card-pad">
              {latestComments.length ? (
                <div style={{ display: "grid", gap: 12 }}>
                  {latestComments.map((c: any, i: number) => (
                    <div key={i} style={{ paddingBottom: 12, borderBottom: i < latestComments.length - 1 ? "1px solid var(--ta-line)" : 0 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 12, color: "var(--ta-muted)" }}>
                          {new Date(c.submitted_at).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" })}
                        </span>
                        <span style={{ fontSize: 12, color: "var(--ta-muted)" }}>{c.q10_score ?? "—"} / 5 overall</span>
                      </div>
                      {c.liked_most && <p style={{ margin: "6px 0 2px", fontSize: 13.5 }}><strong>Liked:</strong> {c.liked_most}</p>}
                      {c.improve && <p style={{ margin: "2px 0", fontSize: 13.5, color: "var(--ta-ink)" }}><strong>Improve:</strong> {c.improve}</p>}
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState message="No written comments yet." />
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

async function ScheduleOptions({ supabase }: { supabase: any }) {
  const { data } = await supabase
    .from("course_schedules")
    .select("id, schedule_code, courses(title, course_name), start_date")
    .is("deleted_at", null)
    .order("start_date", { ascending: false })
    .limit(200);
  return (data ?? []).map((s: any) => (
    <option key={s.id} value={s.id}>
      {s.courses?.title ?? s.courses?.course_name ?? "Schedule"} — {s.schedule_code ?? ""} ({new Date(s.start_date).toLocaleDateString("en-MY", { month: "short", year: "numeric" })})
    </option>
  ));
}
