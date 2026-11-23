/**
 * W8-H homepage contract (owner-approved W8-H G1, local only). Proves the named edits in scripts/w8h-approved.mts are the
 * only changes to the homepage and hero stylesheet, that the course list is rendered once (programme cards) while
 * CourseTable.js stays in the repository, and that the hero keeps the approved phone heading and image assets.
 *
 * Run: node --experimental-transform-types scripts/w8h-homepage-contract.mts
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { revertW8h, W8H_CHANGED } from "./w8h-approved.mts";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const read = (p: string) => readFileSync(path.join(root, p), "utf8");
const sha256 = (text: string) => createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex");
let failures = 0;
const check = (name: string, fn: () => void) => {
  try { fn(); console.log(`LULUS ${name}`); } catch (error) { failures += 1; console.log(`GAGAL ${name} -> ${(error as Error).message.split("\n")[0]}`); }
};
const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };

// SHA-256 (LF-normalised) at main 3abfdfa9 (unchanged since c3c46478 for these files), before W8-H.
const BEFORE: Record<string, string> = {
  "app/page.js": "c5ee115ff9dbe658db04bb7197105d1e3de43594ac20ce130324197222806b0b",
  "components/home/hero.module.css": "6812edf213463a4e07b4d2ef16c37a9b9c459b736f2da3f545aeb7402c300759",
};
// Untouched by W8-H: the kept CourseTable component, the delivery block, the programme cards, homepage copy and styles.
const UNCHANGED: Record<string, string> = {
  "components/home/CourseTable.js": "8ee7d7ccb9a8be3cd1d7951ee5ee4fb6fc9291d6d4a6fea2b93ef5e04cb8a2cc",
  "components/home/DeliveryOptions.js": "f30496e6a325b1f087655af49150ca587bb9e65db085ccd7b1dd23addeb02c1c",
  "components/home/CoreProgrammes.js": "74e9b2b8dc86b673ff65294908f29ea2d2461e5a96ab2b1dbed7ec2c32ae53ae",
  "content/en/home.js": "315b563f2e8e90d30a7a9ad381f2a268b042b9cddd4e2f2febe65eb122d07ea4",
  "components/home/home.module.css": "a674c7c380349b1a4da0db272074a11c7d4c20ab36225191d2bed0dc65d2ce81",
};

check("scope: exactly app/page.js and hero.module.css carry W8-H named edits", () => {
  assert(JSON.stringify(W8H_CHANGED) === JSON.stringify(Object.keys(BEFORE).sort()), W8H_CHANGED.join(", "));
});
check("integrity: reverting the named edits restores each file exactly (nothing else changed)", () => {
  for (const [p, hash] of Object.entries(BEFORE)) assert(sha256(revertW8h(p, read(p))) === hash, p);
});
check("unchanged: CourseTable, DeliveryOptions, programme cards, homepage copy and styles", () => {
  for (const [p, hash] of Object.entries(UNCHANGED)) assert(sha256(read(p)) === hash, p);
});
const page = read("app/page.js");
check("homepage: the course list is rendered once; CourseTable kept in the repository but not rendered", () => {
  assert(!/import CourseTable|<CourseTable/.test(page), "CourseTable still imported or rendered");
  assert(!/>All courses</.test(page), "All courses heading still rendered");
  assert(existsSync(path.join(root, "components/home/CourseTable.js")), "CourseTable.js removed");
  assert(/<CoreProgrammes \/>/.test(page) && /<UpcomingDates rows=\{scheduleRows\} \/>/.test(page), "cards and sessions kept");
  assert(/<DeliveryOptions \/>/.test(page) && /<Recognition \/>/.test(page) && /<HomeFaq \/>/.test(page) && /<HomeContact \/>/.test(page), "other sections kept");
});
check("homepage: #courses keeps its id, a visually hidden h2, and one line naming every course without a card", () => {
  assert(/<section id="courses" className=\{styles\.courses\} aria-labelledby="courses-title">\s*<h2 id="courses-title" className="sr-only">More courses and training delivery<\/h2>/.test(page), "section heading");
  assert(page.includes("const coveredByCards = new Set(homeContent.courses.items.flatMap((item) => item.catalogSlugs));"), "cards coverage from content");
  assert(page.includes("const moreCourses = courseCatalog.filter((course) => !coveredByCards.has(course.slug));"), "remaining courses from the catalogue");
  assert(page.includes("Also available: {moreCourses.map(") && page.includes("<a className={styles.tl} href={`/training/${course.slug}`}>{course.title}</a>") && page.includes('href="/training">All course details</a>'), "every course named and linked");
});
const hero = read("components/home/hero.module.css");
check("hero: R3 two-line desktop headline (720px column; 620px and 52px at 1181-1499px); phone heading unchanged", () => {
  assert(/--hero-copy: 720px;/.test(hero), "desktop copy column");
  assert(/@media \(min-width: 1181px\) and \(max-width: 1499px\) \{[\s\S]*?--hero-copy: 620px;[\s\S]*?\.copy \.title \{ font-size: 3\.25rem; \}/.test(hero), "narrow desktop");
  assert(/\.copy \.title \{ margin-top: 18px; color: var\(--px-white\); font-size: clamp\(2\.75rem, 4\.4vw, 4rem\); line-height: 1\.02; \}/.test(hero), "desktop size rule kept");
  assert(/:global\(#main-content\) \.title \{ margin-top: 10px; font-size: clamp\(31px, 7\.9vw, 56px\); line-height: 1\.02; letter-spacing: -0\.04em; text-wrap: initial; \}/.test(hero), "approved phone heading");
  assert(!/url\(/.test(hero), "no new image asset");
});

console.log(failures ? `\n${failures} semakan GAGAL` : "\nSemua semakan LULUS");
process.exit(failures ? 1 : 0);
