import { unstable_cache } from "next/cache";
import { getSupabaseClient } from "./supabase";
import { createSupabaseServerClient } from "./supabase/server";

/**
 * PUBLIC-SIDE read helpers. These let the existing public website render
 * from the CMS instead of hard-coded arrays. All reads go through the anon
 * key + RLS, so only `published` / live rows are ever returned.
 *
 * Results are cached with a tag so admin mutations can revalidate instantly
 * (call revalidateTag('courses') in the relevant server action, or rely on
 * the short revalidate window below).
 *
 * INTEGRATION (no redesign — swap the data source only):
 *   // app/page.js (or a server component) — replace the hard-coded
 *   // `programmes` array with:
 *   import { getPublishedCourses } from "@/lib/public-content";
 *   const courses = await getPublishedCourses();
 *   // then map over `courses` exactly as before.
 */

export const getPublishedCourses = unstable_cache(
  async () => {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase
      .from("courses")
      .select("id, title, slug, category, summary, featured, sort_order")
      .eq("status", "published")
      .is("deleted_at", null)
      .order("sort_order", { ascending: true });
    return data ?? [];
  },
  ["public-courses"],
  { tags: ["courses"], revalidate: 60 }
);

export const getFeaturedCourses = unstable_cache(
  async () => {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase
      .from("courses")
      .select("id, title, slug, category, summary")
      .eq("status", "published")
      .eq("featured", true)
      .is("deleted_at", null)
      .order("sort_order", { ascending: true });
    return data ?? [];
  },
  ["public-featured-courses"],
  { tags: ["courses"], revalidate: 60 }
);

/**
 * Shape of a published training session as shown on the public site, exactly
 * matching the columns returned by the public-safe RPC
 * `get_public_upcoming_schedules` (see supabase/migrations/20260813000000).
 * Only fields safe/appropriate for anonymous visitors are exposed — never
 * trainer details, internal notes, or registration records.
 */
export interface PublicSchedule {
  id: string;
  course_id: string;
  title: string;
  slug: string | null;
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  venue: string | null;
  delivery_mode: string | null;
  status: string;
  capacity: number;
  available_seats: number;
}

const mapSchedule = (row: any): PublicSchedule => ({
  id: row.schedule_id,
  course_id: row.course_id,
  title: row.course_title,
  slug: row.course_slug,
  start_date: row.start_date,
  end_date: row.end_date,
  start_time: row.start_time ?? null,
  end_time: row.end_time ?? null,
  venue: row.venue,
  delivery_mode: row.delivery_mode,
  status: row.status,
  capacity: Number(row.capacity ?? 0),
  available_seats: Number(row.available_seats ?? 0),
});

/**
 * All published, non-deleted schedules (past included) via the public-safe
 * RPC. The function is SECURITY DEFINER: anon is granted EXECUTE only, and
 * has no direct table grants on course_schedules/courses (verified live:
 * 42501 on direct reads). If the RPC is unavailable or returns no rows, the
 * helpers degrade to an empty list and the homepage/calendar render their
 * professional empty state.
 */
export const getPublishedSchedules = unstable_cache(
  async (): Promise<PublicSchedule[]> => {
    const supabase = getSupabaseClient();
    try {
      const { data, error } = await supabase.rpc("get_public_upcoming_schedules", { p_include_past: true });
      if (error) return [];
      return (data ?? []).map(mapSchedule);
    } catch {
      return [];
    }
  },
  ["public-schedules"],
  { tags: ["schedules"], revalidate: 60 }
);

/**
 * Upcoming open/full sessions, earliest first, capped at 3 for the homepage
 * preview. The date/status filtering is done inside the RPC so anon never
 * reads the underlying tables. Separate cache entry from
 * getPublishedSchedules — nested unstable_cache calls are not supported.
 */
export const getUpcomingSchedules = unstable_cache(
  async (): Promise<PublicSchedule[]> => {
    const supabase = getSupabaseClient();
    try {
      const { data, error } = await supabase.rpc("get_public_upcoming_schedules", { p_include_past: false });
      if (error) return [];
      return (data ?? []).map(mapSchedule).slice(0, 3);
    } catch {
      return [];
    }
  },
  ["public-upcoming-schedules"],
  { tags: ["schedules"], revalidate: 60 }
);

export const getGallery = unstable_cache(
  async () => {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase
      .from("gallery_images")
      .select("id, title, alt_text, image_url, category_id")
      .eq("status", "published")
      .is("deleted_at", null)
      .order("sort_order", { ascending: true });
    return data ?? [];
  },
  ["public-gallery"],
  { tags: ["gallery"], revalidate: 60 }
);

export const getPublishedFaqs = unstable_cache(
  async () => {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase
      .from("faqs")
      .select("id, question, answer, category_id")
      .eq("status", "published")
      .is("deleted_at", null)
      .order("sort_order", { ascending: true });
    return data ?? [];
  },
  ["public-faqs"],
  { tags: ["faqs"], revalidate: 60 }
);

export const getCompanyProfile = unstable_cache(
  async () => {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.from("company_profile").select("*").eq("id", 1).single();
    return data;
  },
  ["public-company"],
  { tags: ["company"], revalidate: 120 }
);
