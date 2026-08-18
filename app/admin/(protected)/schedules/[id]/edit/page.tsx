import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import { requireModuleAccess, requireRole } from "../../../../../../lib/auth/session";
import { PageHead, Card } from "../../../../../../components/admin/ui";
import { ScheduleForm } from "../../ScheduleForm";
import { GroupsPanel } from "../../GroupsPanel";
import { updateSchedule } from "../../actions";
import { loadCourseOptions, loadAssessorOptions, loadTrainerOptions } from "../../options";

export const metadata = { title: "Edit Schedule — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

export default async function EditSchedulePage({ params }: { params: Promise<{ id: string }> }) {
  await requireModuleAccess("schedules");
  await requireRole("admin");
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: schedule } = await supabase.from("course_schedules").select("*, courses(course_name)").eq("id", id).single();
  if (!schedule) notFound();

  // Current primary assessor assignment (for the form's default selection
  // and as the "Use Class Assessor" label in the Training Groups panel).
  const { data: assignment } = await supabase
    .from("schedule_assessors")
    .select("assessor_id, assessors(full_name)")
    .eq("schedule_id", id)
    .eq("is_primary", true)
    .maybeSingle();
  const defaultAssessorId = (assignment as any)?.assessor_id ?? undefined;
  const scheduleAssessorName = (assignment as any)?.assessors?.full_name ?? null;

  const [courses, assessorOptions, trainerOptions] = await Promise.all([loadCourseOptions(), loadAssessorOptions(), loadTrainerOptions()]);
  const boundUpdate = updateSchedule.bind(null, id);

  // Training Schedule Groups V1 — same query shape as the schedule detail
  // page's GroupsPanel section (reused component, not a second subsystem).
  const { data: groupRows } = await supabase
    .from("schedule_groups")
    .select("id, name, trainer_id, assessor_id, capacity, start_time, end_time, trainers(full_name), assessors(full_name)")
    .eq("schedule_id", id)
    .is("deleted_at", null)
    .order("name");
  const { data: groupCounts } = await supabase
    .from("schedule_participants")
    .select("schedule_group_id")
    .eq("schedule_id", id)
    .is("deleted_at", null)
    .neq("registration_status", "cancelled")
    .not("schedule_group_id", "is", null);
  const participantCountByGroup = new Map<string, number>();
  for (const r of (groupCounts ?? []) as any[]) {
    if (r.schedule_group_id) participantCountByGroup.set(r.schedule_group_id, (participantCountByGroup.get(r.schedule_group_id) ?? 0) + 1);
  }
  const groups = (groupRows ?? []).map((g: any) => ({
    id: g.id,
    name: g.name,
    trainer_id: g.trainer_id,
    trainer_name: g.trainers?.full_name ?? null,
    assessor_id: g.assessor_id,
    assessor_name: g.assessors?.full_name ?? null,
    capacity: g.capacity,
    start_time: g.start_time,
    end_time: g.end_time,
    participant_count: participantCountByGroup.get(g.id) ?? 0,
  }));

  return (
    <>
      <PageHead title="Edit Schedule" subtitle={`${schedule.schedule_code ?? ""} · ${(schedule as any).courses?.course_name ?? ""}`} />
      <ScheduleForm action={boundUpdate} schedule={schedule} courses={courses} assessors={assessorOptions} defaultAssessorId={defaultAssessorId} mode="edit" />

      <div style={{ maxWidth: 820, marginTop: 18 }}>
        <Card title="Training Groups">
          <div className="ta-form-pad">
            <p style={{ color: "var(--ta-muted)", fontSize: 13, margin: "0 0 12px" }}>
              Optional — only add groups if this class needs more than one trainer. A schedule with no groups keeps behaving exactly as before.
            </p>
            <GroupsPanel scheduleId={id} groups={groups} trainers={trainerOptions} assessors={assessorOptions} scheduleAssessorName={scheduleAssessorName} />
          </div>
        </Card>
      </div>
    </>
  );
}
