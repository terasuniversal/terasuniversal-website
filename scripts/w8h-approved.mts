/**
 * W8-H (owner-approved W8-H G1, local only): the exact, named edits of the homepage condensation and hero scale.
 *   app/page.js                     the "All courses" table (components/home/CourseTable.js, kept in the repository) is no
 *                                   longer rendered; the #courses section keeps its id and a visually hidden h2 above the
 *                                   unchanged "How training is delivered" block.
 *   components/home/hero.module.css the R3 two-line headline on desktop: a 720px copy column (64px headline, unchanged) and,
 *                                   at 1181-1499px, a 620px column with a 52px headline (was 410px and 50px, three lines).
 * revertW8h(path, text) undoes ONLY these edits and fails closed when an edit is not found exactly once.
 * revertPublicFirst() applies it first (latest change first). Generated from git diff -U1 against main 3abfdfa9;
 * strings are JSON-escaped verbatim.
 */
const EDITS: Record<string, [string, string][]> = {
  "app/page.js": [
    [
      "import CoreProgrammes from \"../components/home/CoreProgrammes\";\nimport UpcomingDates from \"../components/home/UpcomingDates\";\n",
      "import CoreProgrammes from \"../components/home/CoreProgrammes\";\nimport CourseTable from \"../components/home/CourseTable\";\nimport UpcomingDates from \"../components/home/UpcomingDates\";\n"
    ],
    [
      "import styles from \"../components/home/home.module.css\";\nimport { homeContent } from \"../content/en/home\";\n\n",
      "import styles from \"../components/home/home.module.css\";\n\n"
    ],
    [
      "const publicScheduleCourse = (session) => catalogueCourseForSession(session, courseCatalog);\n// W8-H-a: catalogue courses that no programme card covers, so every course is still named and linked on the homepage now\n// that the \"All courses\" table is not rendered.\nconst coveredByCards = new Set(homeContent.courses.items.flatMap((item) => item.catalogSlugs));\nconst moreCourses = courseCatalog.filter((course) => !coveredByCards.has(course.slug));\n\n",
      "const publicScheduleCourse = (session) => catalogueCourseForSession(session, courseCatalog);\n\n"
    ],
    [
      "        <LegacyAnchors />\n        {/* W8-H-a (owner-approved): the \"All courses\" table repeated the programme cards above and the /training catalogue,\n            so it is no longer rendered here (components/home/CourseTable.js is kept). One line still names and links every\n            course without a card, the section keeps its #courses id for old links, and a visually hidden h2 keeps the\n            heading order for the delivery block below. */}\n        <section id=\"courses\" className={styles.courses} aria-labelledby=\"courses-title\">\n          <h2 id=\"courses-title\" className=\"sr-only\">More courses and training delivery</h2>\n          <p className={styles.intro}>Also available: {moreCourses.map((course, index) => <span key={course.slug}>{index > 0 ? \", \" : \"\"}<a className={styles.tl} href={`/training/${course.slug}`}>{course.title}</a></span>)}. <a className={styles.tl} href=\"/training\">All course details</a></p>\n          <DeliveryOptions />\n",
      "        <LegacyAnchors />\n        <section id=\"courses\" className={styles.courses} aria-labelledby=\"courses-title\">\n          <div className={styles.axis}>\n            <h2 id=\"courses-title\" className={styles.h2}>All courses</h2>\n            <p className={styles.intro}>Every course, how long it runs and how it is delivered.</p>\n          </div>\n          <CourseTable />\n          <p className={styles.more}><a className={styles.tl} href=\"/training\">All course details</a></p>\n          <DeliveryOptions />\n"
    ]
  ],
  "components/home/hero.module.css": [
    [
      "     wider than (space right of the copy) / (1 - 0.446); 40px keeps a gap and absorbs the scrollbar inside 100vw. */\n  /* W8-H-b (owner-approved, R3 two-line headline): wide enough for \"Empowering Industry.\" on one line at 64px; measured to\n     keep at least 40px clear of the first worker from 1500px up. */\n  --hero-copy: 720px;\n  --hero-media-w: min(1230px, calc((100vw - max(0px, (100vw - var(--px-max)) / 2) - var(--px-m) - var(--hero-copy) - 40px) / 0.554));\n",
      "     wider than (space right of the copy) / (1 - 0.446); 40px keeps a gap and absorbs the scrollbar inside 100vw. */\n  --hero-copy: 520px;\n  --hero-media-w: min(1230px, calc((100vw - max(0px, (100vw - var(--px-max)) / 2) - var(--px-m) - var(--hero-copy) - 40px) / 0.554));\n"
    ],
    [
      "@media (min-width: 1181px) and (max-width: 1499px) {\n  /* W8-H-b (owner-approved): two-line 52px headline as in R3 (was three lines at 50px in a 410px column); measured to keep\n     at least 66px clear of the first worker at 1181-1499px. */\n  .hero { --hero-copy: 620px; }\n  .copy .title { font-size: 3.25rem; }\n  .copy .lead { font-size: 1.125rem; }\n",
      "@media (min-width: 1181px) and (max-width: 1499px) {\n  .hero { --hero-copy: 410px; }\n  .copy .title { font-size: 3.125rem; }\n  .copy .lead { font-size: 1.125rem; }\n"
    ]
  ]
};

export const W8H_CHANGED = Object.keys(EDITS).sort();
export const W8H_ADDED = ["scripts/w8h-approved.mts", "scripts/w8h-homepage-contract.mts"];

export function revertW8h(path: string, text: string): string {
  const crlf = text.includes("\r\n");
  const eol = (s: string) => (crlf ? s.replace(/\r?\n/g, "\r\n") : s);
  let out = text;
  for (const [now, before] of EDITS[path] ?? []) {
    const from = eol(now);
    if (out.split(from).length !== 2) throw new Error(`W8-H: expected edit not found exactly once in ${path}`);
    out = out.replace(from, () => eol(before));
  }
  return out;
}
