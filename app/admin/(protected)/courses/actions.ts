"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { requireRole } from "../../../../lib/auth/session";
import { courseSchema, fieldErrors } from "../../../../lib/validation/schemas";

export type CourseFormState = {
  errors?: Record<string, string>;
  message?: string;
};

/** Parse a textarea of newline-separated lines into a clean string[]. */
function lines(value: FormDataEntryValue | null): string[] {
  return String(value ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

function readForm(formData: FormData) {
  return {
    title: String(formData.get("title") ?? ""),
    slug: String(formData.get("slug") ?? ""),
    category: String(formData.get("category") ?? ""),
    summary: String(formData.get("summary") ?? ""),
    overview: String(formData.get("overview") ?? ""),
    objectives: lines(formData.get("objectives")),
    duration: String(formData.get("duration") ?? ""),
    delivery_modes: formData.getAll("delivery_modes").map(String) as any,
    target_audience: lines(formData.get("target_audience")),
    requirements: lines(formData.get("requirements")),
    modules: lines(formData.get("modules")).map((title) => ({ title })),
    faq: [], // managed in a dedicated sub-editor; omitted from the basic form
    fee: formData.get("fee") ? Number(formData.get("fee")) : null,
    status: String(formData.get("status") ?? "draft"),
    featured: formData.get("featured") === "on",
    sort_order: Number(formData.get("sort_order") ?? 0),
    seo_title: String(formData.get("seo_title") ?? ""),
    seo_description: String(formData.get("seo_description") ?? ""),
    certificate_type: String(formData.get("certificate_type") ?? "completion"),
    attendance_min_percent: formData.get("attendance_min_percent") ?? 100,
    assessment_required: formData.get("assessment_required") === "on",
    competency_required: formData.get("competency_required") === "on",
    certificate_generation_enabled: formData.get("certificate_generation_enabled") === "on",
    certificate_template_id: (formData.get("certificate_template_id") as string) || null,
  };
}

export async function createCourse(
  _prev: CourseFormState,
  formData: FormData
): Promise<CourseFormState> {
  await requireRole("editor");
  const parsed = courseSchema.safeParse(readForm(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const supabase = await createSupabaseServerClient();

  // The live `courses` table has no unique constraint on slug (only
  // course_code is unique), so the 23505 handling below never actually
  // fires on its own — check for an existing non-deleted match first.
  const { data: existing, error: lookupError } = await supabase
    .from("courses")
    .select("id")
    .eq("slug", parsed.data.slug)
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();
  if (lookupError) return { message: lookupError.message };
  if (existing) return { errors: { slug: "That slug is already in use." } };

  const payload: any = { ...parsed.data };
  if (payload.status === "published") payload.published_at = new Date().toISOString();

  const { error } = await supabase.from("courses").insert(payload);
  if (error) {
    if (error.code === "23505") return { errors: { slug: "That slug is already in use." } };
    return { message: error.message };
  }
  revalidatePath("/admin/courses");
  redirect("/admin/courses");
}

export async function updateCourse(
  id: string,
  _prev: CourseFormState,
  formData: FormData
): Promise<CourseFormState> {
  await requireRole("editor");
  const parsed = courseSchema.safeParse(readForm(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const supabase = await createSupabaseServerClient();

  // Same app-layer slug check as createCourse — no unique constraint exists
  // live, so a course could otherwise be renamed to collide with another.
  const { data: existing, error: lookupError } = await supabase
    .from("courses")
    .select("id")
    .eq("slug", parsed.data.slug)
    .is("deleted_at", null)
    .neq("id", id)
    .limit(1)
    .maybeSingle();
  if (lookupError) return { message: lookupError.message };
  if (existing) return { errors: { slug: "That slug is already in use." } };

  const payload: any = { ...parsed.data };

  // Only stamp published_at on the actual draft/archived → published transition,
  // not on every save of an already-published course (that would corrupt the
  // true original publish date and resurface old content as "just published").
  if (payload.status === "published") {
    const { data: existing } = await supabase.from("courses").select("status, published_at").eq("id", id).single();
    if (!existing || existing.status !== "published" || !existing.published_at) {
      payload.published_at = new Date().toISOString();
    }
  }

  const { error } = await supabase.from("courses").update(payload).eq("id", id);
  if (error) {
    if (error.code === "23505") return { errors: { slug: "That slug is already in use." } };
    return { message: error.message };
  }
  revalidatePath("/admin/courses");
  revalidatePath(`/admin/courses/${id}`);
  redirect("/admin/courses");
}

/** Soft delete (sets deleted_at). Public site immediately stops showing it. */
export async function archiveCourse(id: string) {
  await requireRole("editor");
  const supabase = await createSupabaseServerClient();
  await supabase.from("courses").update({ status: "archived" }).eq("id", id);
  revalidatePath("/admin/courses");
}

export async function softDeleteCourse(id: string) {
  await requireRole("admin");
  const supabase = await createSupabaseServerClient();
  await supabase.from("courses").update({ deleted_at: new Date().toISOString() }).eq("id", id);
  revalidatePath("/admin/courses");
}

export async function restoreCourse(id: string) {
  await requireRole("admin");
  const supabase = await createSupabaseServerClient();
  await supabase.from("courses").update({ deleted_at: null }).eq("id", id);
  revalidatePath("/admin/courses");
}
