import { requireRole } from "../../../../lib/auth/session";
import { ScaffoldPage } from "../../../../components/admin/ScaffoldPage";

export const metadata = { title: "Training Schedule — TERAS UNIVERSAL Admin" };

export default async function Page() {
  await requireRole("editor");
  return (
    <ScaffoldPage
      title="Training Schedule"
      subtitle="Create, edit, cancel and duplicate course sessions."
      table="course_schedules"
      bullets={[
            "Course, trainer, venue, dates and times",
            "Capacity and available seats (auto-computed)",
            "Registration status and course fee",
            "Publishing to the website",      ]}
    />
  );
}
