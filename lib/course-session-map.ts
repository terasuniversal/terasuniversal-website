// Course-to-session mapping for the public pages (Phase S4B). One place for the rules the homepage session list, the
// training calendar and the course-detail pages each carried inline before S4B; the behaviour is unchanged and
// scripts/course-session-map-contract.mts proves it against the pre-S4B implementations.
// Pure functions: no data fetching, no caching, no change to how schedules are selected. The catalogue is passed in, so
// this module stays importable from client components and from plain-Node contract tests (data/courseCatalog.js imports
// a TypeScript module without an extension, which plain Node cannot resolve).

/** The catalogue fields the mapping reads. */
export interface CatalogueCourseRef {
  slug: string;
  title?: string;
  crmCourseId?: string;
  duration?: string;
}

/** The schedule fields the mapping reads (as returned by lib/public-content.ts). */
export interface ScheduleCourseRef {
  course_id: string;
  slug: string | null;
  title?: string;
}

/**
 * Catalogue course for a schedule: the stable CRM course identity first (the CRM slug may intentionally differ from the
 * public route slug), then the public slug. Null when neither matches; the caller then offers an enquiry instead of a
 * course link.
 */
export function catalogueCourseForSession<T extends CatalogueCourseRef>(session: ScheduleCourseRef, catalogue: readonly T[]): T | null {
  const byCrmId = catalogue.find((course) => course.crmCourseId && course.crmCourseId === session.course_id);
  if (byCrmId) return byCrmId;
  return catalogue.find((course) => course.slug === session.slug) ?? null;
}

/**
 * Schedules that belong to a catalogue course (course-detail page). With a CRM identity (the catalogue's crmCourseId, or
 * the published course row's id when the page resolved one) only that identity matches; otherwise the legacy match on
 * slug or exact title is kept for compatibility. Date filtering stays with the caller.
 */
export function sessionsForCourse<S extends ScheduleCourseRef>(course: CatalogueCourseRef, canonicalCourse: { id: string } | null | undefined, sessions: readonly S[]): S[] {
  // Same branch condition as the pre-S4B page: a resolved course row selects the identity path even before its id is read.
  const useIdentity = Boolean(course.crmCourseId || canonicalCourse);
  const identity = course.crmCourseId || canonicalCourse?.id;
  return sessions.filter((session) => (useIdentity
    ? session.course_id === identity
    : session.slug === course.slug || session.title === course.title));
}

/** The catalogue duration when it is stated as a number of days ("2 Days", "10 Days"); null for "to be confirmed" wording. */
export function catalogueDurationText(course: CatalogueCourseRef | null | undefined): string | null {
  return course?.duration && /^\d+\s+Days?$/i.test(course.duration) ? course.duration : null;
}
