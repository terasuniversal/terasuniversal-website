import { createSupabaseServerClient } from "../../../../lib/supabase/server";

/** Course options for the schedule form (used to snapshot course_name). */
export async function loadCourseOptions() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("courses").select("id, title").is("deleted_at", null).order("title");
  return (data ?? []).map((c: any) => ({ id: c.id, label: c.title }));
}

/** Active trainer options for the schedule form (links trainer_id + name). */
export async function loadTrainerOptions() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("trainers").select("id, trainer_id, full_name").is("deleted_at", null).eq("status", "active").order("full_name");
  return (data ?? []).map((t: any) => ({ id: t.id, label: `${t.full_name} (${t.trainer_id})`, name: t.full_name }));
}
