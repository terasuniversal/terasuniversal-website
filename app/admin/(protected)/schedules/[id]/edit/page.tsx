import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import { requireModuleAccess, requireRole } from "../../../../../../lib/auth/session";
import { PageHead } from "../../../../../../components/admin/ui";
import { ScheduleForm } from "../../ScheduleForm";
import { updateSchedule } from "../../actions";
import { loadCourseOptions, loadAssessorOptions } from "../../options";

export const metadata = { title: "Edit Schedule — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

export default async function EditSchedulePage({ params }: { params: Promise<{ id: string }> }) {
  await requireModuleAccess("schedules");
  await requireRole("admin");
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: schedule } = await supabase.from("course_schedules").select("*, courses(course_name)").eq("id", id).single();
  if (!schedule) notFound();

  // Current primary assessor assignment (for the form's default selection).
  const { data: assignment } = await supabase
    .from("schedule_assessors")
    .select("assessor_id")
    .eq("schedule_id", id)
    .eq("is_primary", true)
    .maybeSingle();
  const defaultAssessorId = (assignment as any)?.assessor_id ?? undefined;

  const [courses, assessorOptions] = await Promise.all([loadCourseOptions(), loadAssessorOptions()]);
  const boundUpdate = updateSchedule.bind(null, id);
  return (
    <>
      <PageHead title="Edit Schedule" subtitle={`${schedule.schedule_code ?? ""} · ${(schedule as any).courses?.course_name ?? ""}`} />
      <ScheduleForm action={boundUpdate} schedule={schedule} courses={courses} assessors={assessorOptions} defaultAssessorId={defaultAssessorId} mode="edit" />
    </>
  );
}
