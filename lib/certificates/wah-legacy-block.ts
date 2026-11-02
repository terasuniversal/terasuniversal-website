import { isWahCourse } from "./wah-failed-hold";

const WAH_COURSE_LABEL = /(^|[^a-z0-9])work(ing)?[\s_-]*at[\s_-]*heights?([^a-z0-9]|$)|(^|[^a-z0-9])wah([^a-z0-9]|$)/i;

/** Mirrors app.is_wah_course_label in the WAH hardening draft. */
export function isWahCourseLabel(label: string | null | undefined): boolean {
  return Boolean(label) && WAH_COURSE_LABEL.test(label as string);
}

/**
 * Stops a WAH legacy import early so nothing partial is written and staff get a
 * clear message. The database triggers remain the enforcement point, because an
 * Admin session can call the legacy functions without passing through this code.
 */
export function isWahLegacyTarget(courseId: string | null | undefined, ...labels: (string | null | undefined)[]): boolean {
  return isWahCourse(courseId) || labels.some(isWahCourseLabel);
}
