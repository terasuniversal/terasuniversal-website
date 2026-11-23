import { unstable_cache } from "next/cache";
import { getSupabaseClient } from "./supabase";
import { publicRegistrationEnabled } from "./public-registration-gate";

/**
 * PUBLIC-SIDE read helpers for the public website. Every read uses the cookie-free anon client (lib/supabase.js), so
 * these helpers are safe inside unstable_cache, and data comes only from the public-safe SECURITY DEFINER RPCs (published,
 * non-deleted courses and sessions). anon has no direct read access to `courses`.
 *
 * W3-a (owner-approved): the unused CMS helpers (courses, featured courses, gallery, FAQs, company profile) were removed.
 * They read through the cookie-bound server client inside unstable_cache and discarded errors. FAQ and gallery return,
 * with explicit error states, once their content policies are fixed in Production (W3-b).
 *
 * Results are cached with a tag so admin mutations can revalidate instantly (revalidateTag("schedules") in the schedule
 * actions), otherwise within the short revalidate window below.
 */

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
  fee: number | null;
  registration_available: boolean;
}

export interface PublicRegistrationSchedule {
  schedule_id: string;
  schedule_code: string | null;
  course_id: string;
  course_title: string;
  course_slug: string | null;
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  venue: string | null;
  delivery_mode: string | null;
  status: string;
  fee: number | null;
  capacity: number;
  available_seats: number;
  registration_available: boolean;
}

export async function getPublicRegistrationSchedule(scheduleId: string): Promise<PublicRegistrationSchedule | null> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.rpc("get_public_registration_schedule", { p_schedule_id: scheduleId });
    if (error || !data) return null;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;
    return {
      schedule_id: row.schedule_id,
      schedule_code: row.schedule_code ?? null,
      course_id: row.course_id,
      course_title: row.course_title,
      course_slug: row.course_slug ?? null,
      start_date: row.start_date,
      end_date: row.end_date,
      start_time: row.start_time ?? null,
      end_time: row.end_time ?? null,
      venue: row.venue ?? null,
      delivery_mode: row.delivery_mode ?? null,
      status: row.status,
      fee: row.fee == null ? null : Number(row.fee),
      capacity: Number(row.capacity ?? 0),
      available_seats: Number(row.available_seats ?? 0),
      // F-1: the server kill switch can only withhold registration, never grant it.
      registration_available: publicRegistrationEnabled() && row.registration_available === true,
    };
  } catch {
    return null;
  }
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
  fee: row.fee == null ? null : Number(row.fee),
  registration_available: publicRegistrationEnabled() && row.registration_available === true,
});

/**
 * All published, non-deleted schedules (past included) via the public-safe
 * RPC. The function is SECURITY DEFINER: anon is granted EXECUTE only, and
 * has no direct table grants on course_schedules/courses (verified live:
 * 42501 on direct reads). If the RPC is unavailable or returns no rows, the
 * helpers degrade to an empty list and the homepage/calendar render their
 * professional empty state.
 */
export const getPublishedSchedulesWithState = unstable_cache(
  async (): Promise<{ schedules: PublicSchedule[]; error: boolean }> => {
    const supabase = getSupabaseClient();
    try {
      const { data, error } = await supabase.rpc("get_public_upcoming_schedules", { p_include_past: true });
      if (error) return { schedules: [], error: true };
      const schedules = (data ?? []).map(mapSchedule);
      const withRegistration = await Promise.all(schedules.map(async (schedule: PublicSchedule) => {
        const context = await getPublicRegistrationSchedule(schedule.id);
        return { ...schedule, fee: context?.fee ?? null, registration_available: context?.registration_available === true };
      }));
      return { schedules: withRegistration, error: false };
    } catch {
      return { schedules: [], error: true };
    }
  },
  ["public-schedules"],
  { tags: ["schedules"], revalidate: 60 }
);

/** Resolve the stable CRM course identity without entering a cookie-bound cache. */
export async function getPublicCourseIdentity(slug: string): Promise<{ id: string; slug: string } | null> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("courses")
      .select("id, slug")
      .eq("slug", slug)
      .eq("status", "published")
      .is("deleted_at", null)
      .maybeSingle();
    return error || !data ? null : data;
  } catch {
    return null;
  }
}

export async function getPublishedSchedules(): Promise<PublicSchedule[]> {
  const result = await getPublishedSchedulesWithState();
  return result.schedules;
}

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
      const schedules = (data ?? []).map(mapSchedule).slice(0, 3);
      return Promise.all(schedules.map(async (schedule: PublicSchedule) => {
        const context = await getPublicRegistrationSchedule(schedule.id);
        return {
          ...schedule,
          fee: context?.fee ?? null,
          registration_available: context?.registration_available === true,
        };
      }));
    } catch {
      return [];
    }
  },
  ["public-upcoming-schedules"],
  { tags: ["schedules"], revalidate: 60 }
);
