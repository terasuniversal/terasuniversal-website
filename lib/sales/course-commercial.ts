import type { Json } from "../supabase/database.types";

export const ACCOMMODATION_PACKAGE_KEY = "accommodation";
export const MEALS_PACKAGE_KEY = "meals";

export interface PackageIncludeSnapshot {
  key: string;
  label: string;
}

export interface CourseCommercialProfileData {
  id: string;
  course_id: string;
  standard_display_name: string;
  hrdf_display_name: string | null;
  hrdf_claimable: boolean;
  quotation_description: string;
  package_includes: Json[];
  accommodation_included_default: boolean;
  accommodation_description_default: string | null;
  meals_included_default: boolean;
  meals_description_default: string | null;
}

export interface CourseCommercialOption {
  course_id: string;
  course_label: string;
  profile: CourseCommercialProfileData;
}

export function normalizePackageIncludeItems(value: Json[] | null | undefined): PackageIncludeSnapshot[] {
  if (!Array.isArray(value)) return [];

  const items: PackageIncludeSnapshot[] = [];
  for (const raw of value) {
    if (typeof raw === "string" && raw.trim()) {
      items.push({ key: slugifyPackageKey(raw), label: raw.trim() });
      continue;
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const record = raw as Record<string, Json>;
    const label = typeof record.label === "string" ? record.label.trim() : "";
    const key = typeof record.key === "string" ? record.key.trim() : slugifyPackageKey(label);
    if (key && label) items.push({ key, label });
  }

  return items.filter((item, index) => items.findIndex((candidate) => candidate.key === item.key) === index);
}

export function buildDefaultPackageSnapshot(profile: CourseCommercialProfileData): PackageIncludeSnapshot[] {
  const snapshot = normalizePackageIncludeItems(profile.package_includes);
  if (profile.accommodation_included_default && profile.accommodation_description_default?.trim()) {
    snapshot.push({ key: ACCOMMODATION_PACKAGE_KEY, label: profile.accommodation_description_default.trim() });
  }
  if (profile.meals_included_default && profile.meals_description_default?.trim()) {
    snapshot.push({ key: MEALS_PACKAGE_KEY, label: profile.meals_description_default.trim() });
  }
  return snapshot;
}

export function canonicalizePackageSnapshot(
  value: PackageIncludeSnapshot[] | null | undefined,
  profile: CourseCommercialProfileData
): PackageIncludeSnapshot[] | { error: string } {
  const submitted = Array.isArray(value) ? value : [];
  const allowed = new Map(normalizePackageIncludeItems(profile.package_includes).map((item) => [item.key, item.label]));
  if (profile.accommodation_description_default?.trim()) allowed.set(ACCOMMODATION_PACKAGE_KEY, profile.accommodation_description_default.trim());
  if (profile.meals_description_default?.trim()) allowed.set(MEALS_PACKAGE_KEY, profile.meals_description_default.trim());

  const result: PackageIncludeSnapshot[] = [];
  for (const item of submitted) {
    if (!item || typeof item.key !== "string" || typeof item.label !== "string") return { error: "Package Includes contains an invalid item." };
    const key = item.key.trim();
    const label = item.label.trim();
    if (!key || !label || !allowed.has(key)) return { error: "Package Includes contains an item not configured for this course." };
    if (result.some((existing) => existing.key === key)) continue;
    result.push({ key, label: label.slice(0, 200) });
  }
  return result;
}

export function commercialName(profile: CourseCommercialProfileData, hrdfClaim: boolean): string {
  return hrdfClaim && profile.hrdf_claimable && profile.hrdf_display_name?.trim()
    ? profile.hrdf_display_name.trim()
    : profile.standard_display_name;
}

function slugifyPackageKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 80) || "package_item";
}

export async function loadCourseCommercialOptions(supabase: any): Promise<CourseCommercialOption[]> {
  const { data: profileRows, error: profileError } = await supabase
    .from("course_commercial_profiles")
    .select("id, course_id, standard_display_name, hrdf_display_name, hrdf_claimable, quotation_description, package_includes, accommodation_included_default, accommodation_description_default, meals_included_default, meals_description_default")
    .order("standard_display_name");
  if (profileError || !profileRows?.length) return [];

  const courseIds = profileRows.map((row: CourseCommercialProfileData) => row.course_id);
  const { data: courses } = await supabase.from("courses").select("id, course_name, title, slug").in("id", courseIds);
  const courseById = new Map<string, { id: string; course_name: string | null; title: string | null; slug: string | null }>(
    (courses ?? []).map((course: { id: string; course_name: string | null; title: string | null; slug: string | null }) => [course.id, course])
  );

  return (profileRows as CourseCommercialProfileData[]).map((profile) => {
    const course = courseById.get(profile.course_id);
    return {
      course_id: profile.course_id,
      course_label: course?.course_name || course?.title || course?.slug || profile.standard_display_name,
      profile,
    };
  });
}
