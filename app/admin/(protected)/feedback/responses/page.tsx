import Link from "next/link";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { requireRole, requireModuleAccess } from "../../../../../lib/auth/session";
import { PageHead, Card, EmptyState, Pagination, Badge } from "../../../../../components/admin/ui";
import { reopenFeedback } from "../actions";

export const metadata = { title: "Feedback Responses — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

export default async function FeedbackResponsesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; schedule?: string }>;
}) {
  await requireRole("editor");
  await requireModuleAccess("feedback_responses");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const scheduleId = sp.schedule ?? "";

  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from("participant_feedback")
    .select(
      "id, schedule_id, status, q1_score, q2_score, q3_score, q4_score, q5_score, q6_score, q7_score, q8_score, q9_score, q10_score, nps, liked_most, improve, had_problem, problem_category, submitted_at, participants(id, full_name, participant_id, company), course_schedules(schedule_code, courses(title, course_name))",
      { count: "exact" }
    )
    .order("submitted_at", { ascending: false, nullsFirst: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (scheduleId) query = query.eq("schedule_id", scheduleId);

  const { data: rows, count, error } = await query;
  if (error) {
    console.error("FeedbackResponsesPage: participant_feedback select failed", { scheduleId: scheduleId || null, code: error.code, message: error.message });
  }
  const dataUnavailable = Boolean(error);
  const pageCount = Math.ceil((count ?? 0) / PAGE_SIZE);

  const overall = (r: any) => {
    const vals = [r.q1_score, r.q2_score, r.q3_score, r.q4_score, r.q5_score, r.q6_score, r.q7_score, r.q8_score, r.q9_score, r.q10_score];
    const present = vals.filter((v) => v !== null);
    if (!present.length) return null;
    return Math.round((present.reduce((s, v) => s + v, 0) / present.length) * 100) / 100;
  };

  return (
    <>
      <PageHead
        title="Feedback Responses"
        subtitle="Individual participant feedback submissions."
        action={<Link href="/admin/feedback" className="ta-btn ta-btn-outline">← Dashboard</Link>}
      />

      <form className="ta-toolbar">
        <label style={{ fontSize: 12, fontWeight: 700, color: "var(--ta-muted)" }}>Schedule
          <select name="schedule" defaultValue={scheduleId} className="ta-filter-select" aria-label="Filter by schedule" style={{ marginLeft: 8, fontWeight: 500 }}>
            <option value="">All schedules</option>
            <ScheduleOptions supabase={supabase} />
          </select>
        </label>
        <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm">Apply</button>
        {scheduleId && <Link className="ta-btn ta-btn-outline ta-btn-sm" href="/admin/feedback/responses">Reset</Link>}
      </form>

      <Card>
        {dataUnavailable ? (
          <EmptyState icon="⚠" message="Feedback data is currently unavailable." />
        ) : rows && rows.length > 0 ? (
          <div className="ta-table-wrap">
            <table className="ta-table">
              <thead>
                <tr>
                  <th>Participant</th>
                  <th>Course / Schedule</th>
                  <th>Overall</th>
                  <th>NPS</th>
                  <th>Problem</th>
                  <th>Comments</th>
                  <th>Submitted</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r: any) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.participants?.full_name ?? "—"}</strong>
                      <div className="ta-lead-sub">
                        {r.participants?.participant_id ?? ""}
                        {r.participants?.company ? ` · ${r.participants.company}` : ""}
                      </div>
                    </td>
                    <td>
                      <strong>{r.course_schedules?.courses?.title ?? r.course_schedules?.courses?.course_name ?? "—"}</strong>
                      <div className="ta-lead-sub">{r.course_schedules?.schedule_code ?? ""}</div>
                    </td>
                    <td style={{ fontWeight: 800, color: "var(--ta-navy)", whiteSpace: "nowrap" }}>
                      {overall(r) ?? "—"} / 5
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>{r.nps ?? "—"}</td>
                    <td>{r.had_problem ? (r.problem_category ?? "Yes") : "No"}</td>
                    <td style={{ maxWidth: 260 }}>
                      {r.liked_most || r.improve ? (
                        <span className="ta-lead-sub">
                          {(r.liked_most || r.improve).length > 120 ? `${(r.liked_most || r.improve).slice(0, 120)}…` : r.liked_most || r.improve}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="ta-lead-sub" style={{ whiteSpace: "nowrap" }}>
                      {r.submitted_at ? new Date(r.submitted_at).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" }) : "—"}
                    </td>
                    <td><Badge status={r.status} /></td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {r.status === "submitted" && (
                        <form action={reopenFeedback.bind(null, r.id)} style={{ display: "inline" }}>
                          <button className="ta-btn ta-btn-outline ta-btn-sm" title="Reopen so the participant may resubmit">Reopen</button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon="✉" message="No feedback submissions yet. Feedback links must be generated for a schedule first." />
        )}
      </Card>

      {!dataUnavailable && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span className="ta-lead-sub" style={{ paddingTop: 14 }}>{count ?? 0} response(s)</span>
          <Pagination page={page} pageCount={pageCount} basePath="/admin/feedback/responses" query={scheduleId ? { schedule: scheduleId } : {}} />
        </div>
      )}
    </>
  );
}

async function ScheduleOptions({ supabase }: { supabase: any }) {
  const { data } = await supabase
    .from("course_schedules")
    .select("id, schedule_code, courses(title, course_name)")
    .is("deleted_at", null)
    .order("start_date", { ascending: false })
    .limit(200);
  return (data ?? []).map((s: any) => (
    <option key={s.id} value={s.id}>
      {s.courses?.title ?? s.courses?.course_name ?? "Schedule"} — {s.schedule_code ?? ""}
    </option>
  ));
}
