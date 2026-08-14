import { createSupabaseServerClient } from "../../../../../lib/supabase/server";

/** Active staff for the assignee dropdown / owner filter — same query shape already used on the Opportunity detail page. */
export async function loadStaffOptions() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name");
  return (data ?? []) as { id: string; full_name: string }[];
}
