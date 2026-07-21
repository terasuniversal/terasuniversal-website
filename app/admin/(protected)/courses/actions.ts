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
    cms_status: String(formData.get("status") ?? "draft"),
    course_name: String(formData.get("title") ?? ""),
    featured: formData.get("featured") === "on",
    sort_order: Number(formData.get("sort_order") ?? 0),
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
  const payload: any = { ...parsed.data };
  

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
  const payload: any = { ...parsed.data };
  

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
  await supabase.from("courses").update({ cms_status: "archived" }).eq("id", id);
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
