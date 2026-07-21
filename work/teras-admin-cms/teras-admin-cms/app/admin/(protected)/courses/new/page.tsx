import { requireRole } from "../../../../../lib/auth/session";
import { PageHead } from "../../../../../components/admin/ui";
import { CourseForm } from "../CourseForm";
import { createCourse } from "../actions";

export const metadata = { title: "New Course — TERAS UNIVERSAL Admin" };

export default async function NewCoursePage() {
  await requireRole("editor");
  return (
    <>
      <PageHead title="New Course" subtitle="Add a training programme." />
      <CourseForm action={createCourse} />
    </>
  );
}
