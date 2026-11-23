/**
 * W3-a (owner-approved W3-G1, local only): the exact, named edits of the public-content reliability change.
 *   lib/public-content.ts: the five unused CMS helpers (getPublishedCourses, getFeaturedCourses, getGallery,
 *     getPublishedFaqs, getCompanyProfile; cookie-bound client inside unstable_cache, errors discarded) are removed with
 *     their now-unused server-client import.
 * revertW3(path, text) undoes ONLY these edits. revertPublicFirst() applies it first (latest change first), so every
 * earlier contract that pins these files to HEAD, to a hash or to the pre-Public-First bytes keeps proving that nothing
 * else in them moved. Generated from the exact HEAD text (5b8a77ad); strings are JSON-escaped verbatim.
 */
const EDITS: Record<string, [string, string][]> = {
  "lib/public-content.ts": [
    [
      "import { unstable_cache } from \"next/cache\";\nimport { getSupabaseClient } from \"./supabase\";\nimport { publicRegistrationEnabled } from \"./public-registration-gate\";\n\n/**\n * PUBLIC-SIDE read helpers for the public website. Every read uses the cookie-free anon client (lib/supabase.js), so\n * these helpers are safe inside unstable_cache, and data comes only from the public-safe SECURITY DEFINER RPCs (published,\n * non-deleted courses and sessions). anon has no direct read access to `courses`.\n *\n * W3-a (owner-approved): the unused CMS helpers (courses, featured courses, gallery, FAQs, company profile) were removed.\n * They read through the cookie-bound server client inside unstable_cache and discarded errors. FAQ and gallery return,\n * with explicit error states, once their content policies are fixed in Production (W3-b).\n *\n * Results are cached with a tag so admin mutations can revalidate instantly (revalidateTag(\"schedules\") in the schedule\n * actions), otherwise within the short revalidate window below.\n */\n\n",
      "import { unstable_cache } from \"next/cache\";\nimport { getSupabaseClient } from \"./supabase\";\nimport { createSupabaseServerClient } from \"./supabase/server\";\nimport { publicRegistrationEnabled } from \"./public-registration-gate\";\n\n/**\n * PUBLIC-SIDE read helpers. These let the existing public website render\n * from the CMS instead of hard-coded arrays. All reads go through the anon\n * key + RLS, so only `published` / live rows are ever returned.\n *\n * Results are cached with a tag so admin mutations can revalidate instantly\n * (call revalidateTag('courses') in the relevant server action, or rely on\n * the short revalidate window below).\n *\n * INTEGRATION (no redesign — swap the data source only):\n *   // app/page.js (or a server component) — replace the hard-coded\n *   // `programmes` array with:\n *   import { getPublishedCourses } from \"@/lib/public-content\";\n *   const courses = await getPublishedCourses();\n *   // then map over `courses` exactly as before.\n */\n\nexport const getPublishedCourses = unstable_cache(\n  async () => {\n    const supabase = await createSupabaseServerClient();\n    const { data } = await supabase\n      .from(\"courses\")\n      .select(\"id, title, slug, category, summary, featured, sort_order\")\n      .eq(\"status\", \"published\")\n      .is(\"deleted_at\", null)\n      .order(\"sort_order\", { ascending: true });\n    return data ?? [];\n  },\n  [\"public-courses\"],\n  { tags: [\"courses\"], revalidate: 60 }\n);\n\nexport const getFeaturedCourses = unstable_cache(\n  async () => {\n    const supabase = await createSupabaseServerClient();\n    const { data } = await supabase\n      .from(\"courses\")\n      .select(\"id, title, slug, category, summary\")\n      .eq(\"status\", \"published\")\n      .eq(\"featured\", true)\n      .is(\"deleted_at\", null)\n      .order(\"sort_order\", { ascending: true });\n    return data ?? [];\n  },\n  [\"public-featured-courses\"],\n  { tags: [\"courses\"], revalidate: 60 }\n);\n\n"
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
