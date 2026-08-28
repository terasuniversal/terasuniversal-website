import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import type { Course, Profile } from "../../../../../lib/supabase/database.types";

/** Active staff for the Owner dropdown — same query shape as sales/tasks/options.ts's loadStaffOptions. */
export async function loadStaffOptions() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name");
  if (error) {
    console.error("marketing_campaigns: failed to load staff options", { message: error.message });
    return [];
  }
  const staff = (data ?? []) as unknown as Pick<Profile, "id" | "full_name">[];
  return staff.map((member) => ({ id: member.id, full_name: member.full_name ?? "Unnamed staff" }));
}

/** Course options for the Campaign form — same query shape as schedules/options.ts's loadCourseOptions. */
export async function loadCourseOptions() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("courses").select("id, title").is("deleted_at", null).order("title");
  if (error) {
    console.error("marketing_campaigns: failed to load course options", { message: error.message });
    return [];
  }
  const courses = (data ?? []) as unknown as Pick<Course, "id" | "title">[];
  return courses.map((course) => ({ id: course.id, label: course.title }));
}
