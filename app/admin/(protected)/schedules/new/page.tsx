import { requireRole } from "../../../../../lib/auth/session";
import { PageHead } from "../../../../../components/admin/ui";
import { ScheduleForm } from "../ScheduleForm";
import { createSchedule } from "../actions";
import { loadCourseOptions } from "../options";
import { getAutomationSettings } from "../../automation/actions";

export const metadata = { title: "New Schedule — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

export default async function NewSchedulePage() {
  await requireRole("admin");
  const [courses, settings] = await Promise.all([loadCourseOptions(), getAutomationSettings()]);
  return (
    <>
      <PageHead title="New Schedule" subtitle="A schedule code is generated automatically." />
      <ScheduleForm action={createSchedule} courses={courses} mode="create" defaultTrainingMode={settings.default_training_mode} />
    </>
  );
}
