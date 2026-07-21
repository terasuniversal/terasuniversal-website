import { createSupabaseServerClient } from "./supabase/server";
import { unstable_cache } from "next/cache";

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

export const getUpcomingSchedules = unstable_cache(
  async () => {
    const supabase = await createSupabaseServerClient();
    const today = new Date().toISOString().slice(0, 10);
    const { data } = await supabase
      .from("schedules")
      .select("id, start_date, end_date, status, seats_available, courses(title, slug)")
      .eq("is_published", true)
      .is("deleted_at", null)
      .gte("start_date", today)
      .order("start_date", { ascending: true });
    return data ?? [];
  },
  ["public-schedules"],
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
