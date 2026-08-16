import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import { requireModuleAccess, requireRole } from "../../../../../../lib/auth/session";
import { PageHead } from "../../../../../../components/admin/ui";
import { ScheduleForm } from "../../ScheduleForm";
import { updateSchedule } from "../../actions";
import { loadCourseOptions } from "../../options";

export const metadata = { title: "Edit Schedule — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

export default async function EditSchedulePage({ params }: { params: Promise<{ id: string }> }) {
await requireModuleAccess("schedules");
  await requireRole("admin");
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: schedule } = await supabase.from("course_schedules").select("*, courses(course_name)").eq("id", id).single();
  if (!schedule) notFound();
  const courses = await loadCourseOptions();
  const boundUpdate = updateSchedule.bind(null, id);
  return (
    <>
      <PageHead title="Edit Schedule" subtitle={`${schedule.schedule_code ?? ""} · ${(schedule as any).courses?.course_name ?? ""}`} />
      <ScheduleForm action={boundUpdate} schedule={schedule} courses={courses} mode="edit" />
    </>
  );
}
