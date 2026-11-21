// FT-1A-2 (owner-approved, 21 Nov 2026): the authentic TERAS training photographs shown on course pages. Only the three
// photographs frozen and released in R2 S2-2 are used (SHA-256 recorded in the S2-2 asset manifest and pinned by
// scripts/ft1a-course-page-contract.mts), and only for the seven courses they depict. Every other course keeps its
// existing abstract panel. Alt text describes what is visible; it never claims an anchorage, guardrail or item of
// equipment is secured, certified or approved, and names no equipment brand.
const SCAFFOLDING = {
  src: "/images/v2/course-card-scaffolding-T095.webp",
  alt: "Trainees erecting a tube-and-coupler scaffold tower during TERAS scaffolding training",
  position: "55% 45%",
};
const INSPECTOR = {
  src: "/images/v2/course-card-inspector-T234.webp",
  alt: "A TERAS trainer and participants reviewing inspection checklists beside a training scaffold",
  position: "30% 50%",
};
const WORKING_AT_HEIGHT = {
  src: "/images/v2/course-card-wah-T495.webp",
  alt: "Trainee wearing a full-body harness and energy-absorbing lanyard during working-at-height training",
  position: "40% 30%",
};

export const COURSE_PHOTOS = {
  "basic-scaffolder-level-1": SCAFFOLDING,
  "intermediate-scaffolder-level-2": SCAFFOLDING,
  "advanced-scaffolder-level-3": SCAFFOLDING,
  "scaffolding-inspector-basic": INSPECTOR,
  "scaffolding-inspector-intermediate": INSPECTOR,
  "scaffolding-inspector-advanced": INSPECTOR,
  "working-at-height": WORKING_AT_HEIGHT,
};

/** The approved photograph for a course slug, or null when the course keeps its abstract panel. */
export function coursePhoto(slug) {
  return COURSE_PHOTOS[slug] ?? null;
}
