import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { requireRole } from "../../../../../lib/auth/session";
import { PageHead } from "../../../../../components/admin/ui";
import { CourseForm } from "../CourseForm";
import { updateCourse, softDeleteCourse } from "../actions";
import type { Course } from "../../../../../lib/supabase/database.types";

export const metadata = { title: "Edit Course — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

export default async function EditCoursePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const profile = await requireRole("editor");
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: course } = await supabase.from("courses").select("*").eq("id", id).single();
  if (!course) notFound();

  // Bind the id into the update action.
  const boundUpdate = updateCourse.bind(null, id);
  const boundDelete = softDeleteCourse.bind(null, id);

  return (
    <>
      <PageHead
        title="Edit Course"
        subtitle={`/${(course as Course).slug}`}
        action={
          <div style={{ display: "flex", gap: 8 }}>
            <a href={`/admin/courses/${id}/preview`} className="ta-btn ta-btn-outline">👁 Preview</a>
            {(profile.role === "admin" || profile.role === "super_admin") && (
              <form action={boundDelete}>
                <button className="ta-btn ta-btn-danger" type="submit">Delete</button>
              </form>
            )}
          </div>
        }
      />
      <CourseForm action={boundUpdate} course={course as Course} />
    </>
  );
}
