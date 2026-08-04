import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { requireAssessment } from "../../../../../lib/auth/session";
import { canManageAssessment, isSuperAdmin } from "../../../../../lib/auth/rbac";
import { PageHead, Card, Badge, EmptyState, StatCard } from "../../../../../components/admin/ui";
import { AssessmentTable, type AsmRow } from "../AssessmentTable";
import { lockAssessments, unlockAssessments } from "../actions";

export const metadata = { title: "Assessment — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

export default async function AssessSchedulePage({
  params,
}: {
  params: Promise<{ scheduleId: string }>;
}) {
  const profile = await requireAssessment(false);
  const canManage = canManageAssessment(profile.role);
  const superAdmin = isSuperAdmin(profile.role);
  const { scheduleId } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: scheduleRow } = await (supabase
    .from("training_schedules") as any)
    .select("id, schedule_id, course_name, trainer, venue, start_date, end_date, status, registered_participants")
    .eq("id", scheduleId)
    .single();
  const s = scheduleRow as { id: string; schedule_id: string; course_name: string; trainer: string | null; venue: string | null; start_date: string; end_date: string | null; status: string; registered_participants: number | null } | null;
  if (!s) notFound();

  const { data: asm } = await supabase
    .from("assessments")
    .select("id, assessment_type, theory_score, practical_score, overall_score, result, competency_status, remarks, locked, participants(participant_id, full_name, company)")
    .eq("schedule_id", scheduleId)
    .is("deleted_at", null)
    .order("assessment_id", { ascending: true });

  const rows: AsmRow[] = (asm ?? []).map((a: any) => ({
    id: a.id, assessment_type: a.assessment_type, theory_score: a.theory_score, practical_score: a.practical_score,
    overall_score: a.overall_score, result: a.result, competency_status: a.competency_status, remarks: a.remarks,
    locked: a.locked, participant: a.participants,
  }));

  const competent = rows.filter((r) => r.competency_status === "competent").length;
  const nyc = rows.filter((r) => r.competency_status === "not_yet_competent").length;
  const passed = rows.filter((r) => r.result === "pass").length;
  const pending = rows.filter((r) => r.result === "pending").length;

  return (
    <>
      <PageHead
        title="Assessment"
        subtitle={`${s.course_name} · ${s.schedule_id}`}
        action={<Link href="/admin/assessment" className="ta-btn ta-btn-outline">← Back</Link>}
      />

      <Card title="Schedule">
        <div className="ta-card-pad" style={{ display: "flex", gap: 26, flexWrap: "wrap" }}>
          <div><small style={{ color: "var(--ta-muted)" }}>Course</small><div><strong>{s.course_name}</strong></div></div>
          <div><small style={{ color: "var(--ta-muted)" }}>Trainer</small><div>{s.trainer ?? "—"}</div></div>
          <div><small style={{ color: "var(--ta-muted)" }}>Venue</small><div>{s.venue ?? "—"}</div></div>
          <div><small style={{ color: "var(--ta-muted)" }}>Date</small><div>{new Date(s.start_date).toLocaleDateString("en-MY")}</div></div>
          <div><small style={{ color: "var(--ta-muted)" }}>Participants</small><div>{s.registered_participants}</div></div>
          <div><small style={{ color: "var(--ta-muted)" }}>Status</small><div><Badge status={s.status} /></div></div>
        </div>
      </Card>

      <div className="ta-grid cols-4" style={{ margin: "18px 0" }}>
        <StatCard icon="✅" label="Competent" value={competent} />
        <StatCard icon="🔁" label="Not Yet Competent" value={nyc} />
        <StatCard icon="🎯" label="Passed" value={passed} />
        <StatCard icon="⏳" label="Pending" value={pending} />
      </div>

      {canManage && rows.length > 0 && (
        <div className="ta-toolbar">
          <form action={lockAssessments.bind(null, scheduleId)}>
            <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm">🔒 Lock all</button>
          </form>
          {superAdmin && (
            <form action={unlockAssessments.bind(null, scheduleId)}>
              <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm">🔓 Unlock all</button>
            </form>
          )}
          <div className="ta-spacer" />
          <a href={`/admin/assessment/${scheduleId}/export?format=csv`} className="ta-btn ta-btn-outline ta-btn-sm">⬇ CSV</a>
          <a href={`/admin/assessment/${scheduleId}/export?format=excel`} className="ta-btn ta-btn-outline ta-btn-sm">⬇ Excel</a>
          <a href={`/admin/assessment/${scheduleId}/export?format=report`} target="_blank" className="ta-btn ta-btn-outline ta-btn-sm">📄 Report (PDF)</a>
        </div>
      )}

      <Card>
        {rows.length > 0 ? (
          <AssessmentTable scheduleId={scheduleId} rows={rows} canManage={canManage} isSuperAdmin={superAdmin} />
        ) : (
          <EmptyState icon="📝" message="No assessment records. Assign participants to this schedule — records are created automatically." />
        )}
      </Card>

      {/* Direct-integration placeholders */}
      <div className="ta-grid cols-4" style={{ marginTop: 18 }}>
        <Card title="Certificate Generator"><div className="ta-card-pad"><EmptyState icon="🏅" message="Auto-issue for competent participants — coming soon." /></div></Card>
        <Card title="Participant History"><div className="ta-card-pad"><EmptyState icon="👤" message="Per-participant results — coming soon." /></div></Card>
        <Card title="Training History"><div className="ta-card-pad"><EmptyState icon="🎓" message="Course outcomes — coming soon." /></div></Card>
        <Card title="Reporting Dashboard"><div className="ta-card-pad"><EmptyState icon="📊" message="Competency analytics — coming soon." /></div></Card>
      </div>
    </>
  );
}
