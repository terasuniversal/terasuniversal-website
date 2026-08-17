import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { requireModuleAccess, requireAssessment } from "../../../../../lib/auth/session";
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
  await requireModuleAccess("assessment");
  const profile = await requireAssessment(false);
  const canManage = canManageAssessment(profile.role);
  const superAdmin = isSuperAdmin(profile.role);
  const { scheduleId } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: scheduleRow } = await supabase
    .from("course_schedules")
    .select("id, schedule_code, trainer_name, venue, start_date, end_date, status, capacity, seats_taken, courses(course_name)")
    .eq("id", scheduleId)
    .single();
  if (!scheduleRow) notFound();
  const s = scheduleRow as any;
  const courseName = s.courses?.course_name ?? "—";

  // Assigned primary assessor (Assessor Management Phase 1 — display only;
  // assessments.assessor_id is per-participant attribution and is untouched).
  const { data: assessorAssignment } = await supabase
    .from("schedule_assessors")
    .select("assessor_id, assessors(full_name)")
    .eq("schedule_id", scheduleId)
    .eq("is_primary", true)
    .maybeSingle();
  const assessorName = (assessorAssignment as any)?.assessors?.full_name ?? null;

  // Enrolled roster, independent of whether an assessment row exists yet.
  const { data: roster } = await supabase
    .from("schedule_participants")
    .select("participant_id, participants(participant_id, full_name, company)")
    .eq("schedule_id", scheduleId)
    .is("deleted_at", null)
    .neq("registration_status", "cancelled")
    .order("enrolled_at", { ascending: true });

  const { data: asm } = await supabase
    .from("assessments")
    .select("id, participant_id, assessment_type, theory_score, practical_score, result, competency_status, remarks, locked")
    .eq("schedule_id", scheduleId)
    .is("deleted_at", null);
  const byParticipant = new Map<string, any>((asm ?? []).map((a: any): [string, any] => [a.participant_id, a]));

  // Participant Skills Record (Phase 2B) -- a missing row per area just
  // means "not_recorded"; nothing is auto-created by viewing this page.
  const { data: skillRows } = await supabase
    .from("participant_skill_results")
    .select("participant_id, area, status")
    .eq("schedule_id", scheduleId)
    .is("deleted_at", null);
  const skillsByParticipant = new Map<string, Record<string, string>>();
  for (const row of (skillRows ?? []) as { participant_id: string; area: string; status: string }[]) {
    const m = skillsByParticipant.get(row.participant_id) ?? {};
    m[row.area] = row.status;
    skillsByParticipant.set(row.participant_id, m);
  }

  const rows: AsmRow[] = (roster ?? []).map((r: any) => {
    const a = byParticipant.get(r.participant_id);
    return {
      id: a?.id ?? null,
      participant_id: r.participant_id,
      assessment_type: a?.assessment_type ?? null,
      theory_score: a?.theory_score ?? null,
      practical_score: a?.practical_score ?? null,
      result: a?.result ?? "pending",
      competency_status: a?.competency_status ?? null,
      remarks: a?.remarks ?? null,
      locked: a?.locked ?? false,
      participant: r.participants,
      skills: skillsByParticipant.get(r.participant_id) ?? {},
    };
  });

  const competent = rows.filter((r) => r.competency_status === "competent").length;
  const nyc = rows.filter((r) => r.competency_status === "not_yet_competent").length;
  const passed = rows.filter((r) => r.result === "pass").length;
  const pending = rows.filter((r) => r.result === "pending").length;
  const lockableIds = rows.map((r) => r.id).filter((id): id is string => id !== null);

  return (
    <>
      <PageHead
        title="Assessment"
        subtitle={`${courseName} · ${s.schedule_code}`}
        action={<Link href="/admin/assessment" className="ta-btn ta-btn-outline">← Back</Link>}
      />

      <Card title="Schedule">
        <div className="ta-card-pad" style={{ display: "flex", gap: 26, flexWrap: "wrap" }}>
          <div><small style={{ color: "var(--ta-muted)" }}>Course</small><div><strong>{courseName}</strong></div></div>
          <div><small style={{ color: "var(--ta-muted)" }}>Trainer</small><div>{s.trainer_name ?? "—"}</div></div>
          <div><small style={{ color: "var(--ta-muted)" }}>Assessor</small><div>{assessorName ?? "Not assigned"}</div></div>
          <div><small style={{ color: "var(--ta-muted)" }}>Venue</small><div>{s.venue ?? "—"}</div></div>
          <div><small style={{ color: "var(--ta-muted)" }}>Date</small><div>{new Date(s.start_date).toLocaleDateString("en-MY")}</div></div>
          <div><small style={{ color: "var(--ta-muted)" }}>Enrolled</small><div>{s.seats_taken}/{s.capacity}</div></div>
          <div><small style={{ color: "var(--ta-muted)" }}>Status</small><div><Badge status={s.status} /></div></div>
        </div>
      </Card>

      <div className="ta-grid cols-4" style={{ margin: "18px 0" }}>
        <StatCard icon="✅" label="Competent" value={competent} />
        <StatCard icon="🔁" label="Not Yet Competent" value={nyc} />
        <StatCard icon="🎯" label="Passed" value={passed} />
        <StatCard icon="⏳" label="Pending" value={pending} />
      </div>

      {canManage && lockableIds.length > 0 && (
        <div className="ta-toolbar">
          <form action={lockAssessments.bind(null, scheduleId)}>
            {lockableIds.map((id) => <input key={id} type="hidden" name="ids" value={id} />)}
            <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm">🔒 Lock all assessed</button>
          </form>
          {superAdmin && (
            <form action={unlockAssessments.bind(null, scheduleId)}>
              {lockableIds.map((id) => <input key={id} type="hidden" name="ids" value={id} />)}
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
          <EmptyState icon="📝" message="No participants enrolled in this schedule yet. Enroll participants from the Training Schedule module." />
        )}
      </Card>

      <div className="ta-grid cols-4" style={{ marginTop: 18 }}>
        <Card title="Certificate Generator"><div className="ta-card-pad"><EmptyState icon="🏅" message="Certificate generation is a later follow-up (see SCHEDULES_ARCHITECTURE_DECISION.md §J)." /></div></Card>
        <Card title="Participant History"><div className="ta-card-pad"><EmptyState icon="👤" message="Per-participant results — coming soon." /></div></Card>
        <Card title="Training History"><div className="ta-card-pad"><EmptyState icon="🎓" message="Course outcomes — coming soon." /></div></Card>
        <Card title="Reporting Dashboard"><div className="ta-card-pad"><EmptyState icon="📊" message="Competency analytics — coming soon." /></div></Card>
      </div>
    </>
  );
}
