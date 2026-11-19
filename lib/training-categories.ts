// Catalogue category selection for public category pages (Phase S4C-1). Pure functions over the catalogue passed in, so
// they work in server components and in plain-Node contract tests (data/courseCatalog.js cannot be imported there).
// Nothing here adds, renames or reorders a course: entries come out exactly as the catalogue lists them.

export interface CategoryCourseRef {
  slug: string;
  title: string;
  category: string;
}

/** The catalogue's own classification for the scaffolding and scaffolding-inspection courses. */
export const SCAFFOLDING_CATEGORY = "Scaffolding Competency";

/** Courses whose catalogue category is exactly `category`, in catalogue order. */
export function coursesInCategory<T extends CategoryCourseRef>(catalogue: readonly T[], category: string): T[] {
  return catalogue.filter((course) => course.category === category);
}

/**
 * The scaffolding category split into two pathways by the catalogue's own titles: "Scaffolding Inspector (…)" courses
 * form the inspection pathway, the other courses in the category the scaffolding pathway. The catalogue has no pathway
 * field, so the titles are the only source; no level, prerequisite or progression is implied by the grouping.
 */
export function scaffoldingPathways<T extends CategoryCourseRef>(courses: readonly T[]): { scaffolding: T[]; inspection: T[] } {
  const isInspection = (course: T) => course.title.startsWith("Scaffolding Inspector");
  return { scaffolding: courses.filter((course) => !isInspection(course)), inspection: courses.filter(isInspection) };
}
