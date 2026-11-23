/**
 * W3-a (owner-approved W3-G1, local only): the exact, named edits of the public-content reliability change.
 *   lib/public-content.ts: the five unused CMS helpers (getPublishedCourses, getFeaturedCourses, getGallery,
 *     getPublishedFaqs, getCompanyProfile; cookie-bound client inside unstable_cache, errors discarded) and the unused
 *     getPublishedSchedules wrapper are removed with their now-unused server-client import; getPublicCourseIdentity (a
 *     direct anon read of `courses`, always null) is replaced by the pure courseIdentityFromSchedules().
 *   app/training/[slug]/page.js: the course identity is derived from the published sessions the page already loads.
 * revertW3(path, text) undoes ONLY these edits. revertPublicFirst() applies it first (latest change first), so every
 * earlier contract that pins these files to HEAD, to a hash or to the pre-Public-First bytes keeps proving that nothing
 * else in them moved. Generated from the exact HEAD text (5b8a77ad); strings are JSON-escaped verbatim.
 */
const EDITS: Record<string, [string, string][]> = {
  "app/training/[slug]/page.js": [
    [
      "import { courseIdentityFromSchedules, getPublishedSchedulesWithState } from \"../../../lib/public-content\";\n",
      "import { getPublicCourseIdentity, getPublishedSchedulesWithState } from \"../../../lib/public-content\";\n"
    ],
    [
      "  const { schedules: publicSchedules, error: scheduleLoadError } = await getPublishedSchedulesWithState();\n  // W3-a: the CRM course identity comes from the published sessions already loaded (no anon read of `courses`).\n  const canonicalCourse = courseIdentityFromSchedules(course.slug, publicSchedules);\n",
      "  const [{ schedules: publicSchedules, error: scheduleLoadError }, canonicalCourse] = await Promise.all([getPublishedSchedulesWithState(), getPublicCourseIdentity(course.slug)]);\n"
    ]
  ],
  "lib/public-content.ts": [
    [
      "import { unstable_cache } from \"next/cache\";\nimport { getSupabaseClient } from \"./supabase\";\nimport { publicRegistrationEnabled } from \"./public-registration-gate\";\n\n/**\n * PUBLIC-SIDE read helpers for the public website. Every read uses the cookie-free anon client (lib/supabase.js), so\n * these helpers are safe inside unstable_cache, and data comes only from the public-safe SECURITY DEFINER RPCs (published,\n * non-deleted courses and sessions). anon has no direct read access to `courses`.\n *\n * W3-a (owner-approved): the unused CMS helpers (courses, featured courses, gallery, FAQs, company profile) were removed.\n * They read through the cookie-bound server client inside unstable_cache and discarded errors. FAQ and gallery return,\n * with explicit error states, once their content policies are fixed in Production (W3-b).\n *\n * Results are cached with a tag so admin mutations can revalidate instantly (revalidateTag(\"schedules\") in the schedule\n * actions), otherwise within the short revalidate window below.\n */\n\n",
      "import { unstable_cache } from \"next/cache\";\nimport { getSupabaseClient } from \"./supabase\";\nimport { createSupabaseServerClient } from \"./supabase/server\";\nimport { publicRegistrationEnabled } from \"./public-registration-gate\";\n\n/**\n * PUBLIC-SIDE read helpers. These let the existing public website render\n * from the CMS instead of hard-coded arrays. All reads go through the anon\n * key + RLS, so only `published` / live rows are ever returned.\n *\n * Results are cached with a tag so admin mutations can revalidate instantly\n * (call revalidateTag('courses') in the relevant server action, or rely on\n * the short revalidate window below).\n *\n * INTEGRATION (no redesign — swap the data source only):\n *   // app/page.js (or a server component) — replace the hard-coded\n *   // `programmes` array with:\n *   import { getPublishedCourses } from \"@/lib/public-content\";\n *   const courses = await getPublishedCourses();\n *   // then map over `courses` exactly as before.\n */\n\nexport const getPublishedCourses = unstable_cache(\n  async () => {\n    const supabase = await createSupabaseServerClient();\n    const { data } = await supabase\n      .from(\"courses\")\n      .select(\"id, title, slug, category, summary, featured, sort_order\")\n      .eq(\"status\", \"published\")\n      .is(\"deleted_at\", null)\n      .order(\"sort_order\", { ascending: true });\n    return data ?? [];\n  },\n  [\"public-courses\"],\n  { tags: [\"courses\"], revalidate: 60 }\n);\n\nexport const getFeaturedCourses = unstable_cache(\n  async () => {\n    const supabase = await createSupabaseServerClient();\n    const { data } = await supabase\n      .from(\"courses\")\n      .select(\"id, title, slug, category, summary\")\n      .eq(\"status\", \"published\")\n      .eq(\"featured\", true)\n      .is(\"deleted_at\", null)\n      .order(\"sort_order\", { ascending: true });\n    return data ?? [];\n  },\n  [\"public-featured-courses\"],\n  { tags: [\"courses\"], revalidate: 60 }\n);\n\n"
    ],
    [
      "/**\n * The stable CRM course identity for a public course slug, taken from the published sessions the public RPC already\n * returned (published, non-deleted course; published, non-cancelled session). W3-a: this replaces a direct anon read of\n * `courses`, which always resolved to null because anon has no read access to that table. Only upcoming sessions count\n * (the same date rule as the course page), so a course with past sessions only keeps its catalogue calendar link. Null\n * when no upcoming session carries the slug, or when sessions disagree on the course id. No database call.\n */\nexport function courseIdentityFromSchedules(slug: string, schedules: readonly PublicSchedule[]): { id: string; slug: string } | null {\n  const today = new Date().toISOString().slice(0, 10);\n  const ids = new Set(schedules.filter((schedule) => schedule.slug === slug && schedule.start_date >= today).map((schedule) => schedule.course_id));\n  return ids.size === 1 ? { id: [...ids][0], slug } : null;\n}\n\n",
      "/** Resolve the stable CRM course identity without entering a cookie-bound cache. */\nexport async function getPublicCourseIdentity(slug: string): Promise<{ id: string; slug: string } | null> {\n  try {\n    const supabase = getSupabaseClient();\n    const { data, error } = await supabase\n      .from(\"courses\")\n      .select(\"id, slug\")\n      .eq(\"slug\", slug)\n      .eq(\"status\", \"published\")\n      .is(\"deleted_at\", null)\n      .maybeSingle();\n    return error || !data ? null : data;\n  } catch {\n    return null;\n  }\n}\n\nexport async function getPublishedSchedules(): Promise<PublicSchedule[]> {\n  const result = await getPublishedSchedulesWithState();\n  return result.schedules;\n}\n\n"
    ],
    [
      " * reads the underlying tables. Separate cache entry from\n * getPublishedSchedulesWithState — nested unstable_cache calls are not supported.\n",
      " * reads the underlying tables. Separate cache entry from\n * getPublishedSchedules — nested unstable_cache calls are not supported.\n"
    ],
    [
      "  [\"public-upcoming-schedules\"],\n  { tags: [\"schedules\"], revalidate: 60 }\n);\n",
      "  [\"public-upcoming-schedules\"],\n  { tags: [\"schedules\"], revalidate: 60 }\n);\n\nexport const getGallery = unstable_cache(\n  async () => {\n    const supabase = await createSupabaseServerClient();\n    const { data } = await supabase\n      .from(\"gallery_images\")\n      .select(\"id, title, alt_text, image_url, category_id\")\n      .eq(\"status\", \"published\")\n      .is(\"deleted_at\", null)\n      .order(\"sort_order\", { ascending: true });\n    return data ?? [];\n  },\n  [\"public-gallery\"],\n  { tags: [\"gallery\"], revalidate: 60 }\n);\n\nexport const getPublishedFaqs = unstable_cache(\n  async () => {\n    const supabase = await createSupabaseServerClient();\n    const { data } = await supabase\n      .from(\"faqs\")\n      .select(\"id, question, answer, category_id\")\n      .eq(\"status\", \"published\")\n      .is(\"deleted_at\", null)\n      .order(\"sort_order\", { ascending: true });\n    return data ?? [];\n  },\n  [\"public-faqs\"],\n  { tags: [\"faqs\"], revalidate: 60 }\n);\n\nexport const getCompanyProfile = unstable_cache(\n  async () => {\n    const supabase = await createSupabaseServerClient();\n    const { data } = await supabase.from(\"company_profile\").select(\"*\").eq(\"id\", 1).single();\n    return data;\n  },\n  [\"public-company\"],\n  { tags: [\"company\"], revalidate: 120 }\n);\n"
    ]
  ]
};

export const W3_CHANGED = Object.keys(EDITS).sort();
export const W3_ADDED = ["scripts/w3-approved.mts", "scripts/w3-public-content-contract.mts"];

export function revertW3(path: string, text: string): string {
  const crlf = text.includes("\r\n");
  const eol = (s: string) => (crlf ? s.replace(/\r?\n/g, "\r\n") : s);
  let out = text;
  for (const [now, before] of EDITS[path] ?? []) {
    const from = eol(now);
    if (out.split(from).length !== 2) throw new Error(`W3: expected edit not found exactly once in ${path}`);
    out = out.replace(from, () => eol(before));
  }
  return out;
}
