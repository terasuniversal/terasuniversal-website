import { requireRole } from "../../../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { PageHead } from "../../../../../components/admin/ui";
import { CourseForm } from "../CourseForm";
import { createCourse } from "../actions";

export const metadata = { title: "New Course — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

export default async function NewCoursePage() {
  await requireRole("editor");
  const supabase = await createSupabaseServerClient();
  const { data: templates } = await supabase
    .from("certificate_templates")
    .select("id, name")
    .is("deleted_at", null)
    .eq("is_active", true)
    .order("name");
  return (
    <>
      <PageHead title="New Course" subtitle="Add a training programme." />
      <CourseForm action={createCourse} templates={templates ?? []} />
    </>
  );
}
