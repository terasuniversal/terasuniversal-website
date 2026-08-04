import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import { requireRole } from "../../../../../../lib/auth/session";
import { PageHead } from "../../../../../../components/admin/ui";
import { ScheduleForm } from "../../ScheduleForm";
import { updateSchedule } from "../../actions";
import { loadCourseOptions, loadTrainerOptions } from "../../options";

export const metadata = { title: "Edit Schedule — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

export default async function EditSchedulePage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("admin");
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: schedule } = await supabase.from("training_schedules").select("*").eq("id", id).single();
  if (!schedule) notFound();
  const [courses, trainers] = await Promise.all([loadCourseOptions(), loadTrainerOptions()]);
  const boundUpdate = updateSchedule.bind(null, id);
  return (
    <>
      <PageHead title="Edit Schedule" subtitle={`${schedule.schedule_id} · ${schedule.course_name}`} />
      <ScheduleForm action={boundUpdate} schedule={schedule} courses={courses} trainers={trainers} mode="edit" />
    </>
  );
}
