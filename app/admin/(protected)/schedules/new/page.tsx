import { requireRole } from "../../../../../lib/auth/session";
import { PageHead } from "../../../../../components/admin/ui";
import { ScheduleForm } from "../ScheduleForm";
import { createSchedule } from "../actions";
import { loadCourseOptions, loadTrainerOptions } from "../options";
import { getAutomationSettings } from "../../automation/actions";

export const metadata = { title: "New Schedule — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

export default async function NewSchedulePage() {
  await requireRole("admin");
  const [courses, trainers, settings] = await Promise.all([loadCourseOptions(), loadTrainerOptions(), getAutomationSettings()]);
  return (
    <>
      <PageHead title="New Schedule" subtitle="A Schedule ID is generated automatically." />
      <ScheduleForm action={createSchedule} courses={courses} trainers={trainers} mode="create" defaultTrainingMode={settings.default_training_mode} />
    </>
  );
}
