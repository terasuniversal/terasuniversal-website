/**
 * W6-SEO-a1 public SEO metadata contract (owner-approved W6-SEO-a1 G1, local only). Proves the named edits in
 * scripts/w6seo-approved.mts are the only changes to the four edited files, that the new course search descriptions stay
 * short and claim-free, and that article publication and indexing states, the sitemap and robots are unchanged.
 *
 * Run: node --experimental-transform-types scripts/w6seo-a1-contract.mts
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { revertW6seo, W6SEO_CHANGED } from "./w6seo-approved.mts";
import { revertW6a2 } from "./w6a2-approved.mts";
import { courseSeoDescriptions } from "../content/en/course-seo.js";
import { insights } from "../data/insights.js";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const read = (p: string) => readFileSync(path.join(root, p), "utf8");
const sha256 = (text: string) => createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex");
let failures = 0;
const check = (name: string, fn: () => void) => {
  try { fn(); console.log(`LULUS ${name}`); } catch (error) { failures += 1; console.log(`GAGAL ${name} -> ${(error as Error).message.split("\n")[0]}`); }
};
const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };

// SHA-256 (LF-normalised) at main 96e58eac, before W6-SEO-a1.
const BEFORE: Record<string, string> = {
  "app/training/[slug]/page.js": "b35da931dc1164285c70d4791b8706567f64adad17d5314c5cab3c9a51766460",
  "app/verify/page.tsx": "471dcfe4a949302f5d4637b60582cf101abadb80353d0c5b79ec7bc8842e3a58",
  "components/InsightsCentre.js": "f2f9e3bfcb8d6079b9029defbb565561a3241d37c9b304e5ef5d11384d57e5ac",
  "content/en/calendar.js": "5ad51c161d7a7b0138894835f4bdaa5ccc26369bd3bab97f3c43175963d07bbb",
};
// Files W6-SEO-a1 must not touch: article data and routes, sitemap, robots, gallery, the course catalogue.
const UNCHANGED: Record<string, string> = {
  "data/insights.js": "159251bacae5830e1236f7552771912eac4ef2347c63d7b6558340a89d61dcac",
  "app/sitemap.js": "786a2716b24488830905e615e68c9ea453b9661be03f653c75d14dd2d0987baa",
  "app/insights/[slug]/page.js": "885cb667d1a1d518461242d4c0d34a873897f23a01667fac01993f1fc184dc3f",
  "app/insights/page.js": "387b732f96a11cdf300638b055e5e9c651ef71776e9e22e0c0e9ff6d6d417b86",
  "app/robots.js": "b8885739b9c70d240b9ed222f436c7524cae77ca1b396811764fea26ab5ff19c",
  "app/gallery/page.js": "e80615c18ea6e4e28749695cd4ac54eaef41f0c65de6699e3f7307d52182310e",
  "data/courseCatalog.js": "e7ac59deacd0767b345a320c59e4ed723844fbff21302d52a06c78bbdd270b16",
};

check("scope: exactly the four approved files carry W6-SEO-a1 named edits", () => {
  assert(JSON.stringify(W6SEO_CHANGED) === JSON.stringify(Object.keys(BEFORE).sort()), W6SEO_CHANGED.join(", "));
});
check("integrity: reverting the named edits restores each file exactly (nothing else changed)", () => {
  for (const [p, hash] of Object.entries(BEFORE)) assert(sha256(revertW6seo(p, read(p))) === hash, p);
});
check("unchanged: article data and routes, sitemap, robots, gallery and course catalogue", () => {
  // W6-SEO-a2 (owner-approved) later edited data/insights.js; its named edits are undone before hashing.
  for (const [p, hash] of Object.entries(UNCHANGED)) assert(sha256(revertW6a2(p, read(p))) === hash, p);
});

// The catalogue imports an extensionless module, so it is read as text (as training-catalogue-contract does).
const catalogue = read("data/courseCatalog.js");
// Each course's title is the first `title:` after its `slug:` (a few entries carry other fields in between).
const courses = [...catalogue.matchAll(/slug: "([^"]+)"/g)].map((m) => ({ slug: m[1], title: (/title: "([^"]+)"/.exec(catalogue.slice(m.index)) ?? [])[1] ?? "" }));
const CLAIMS = /accredit|certif|recogni[sz]|internationa|HRD|DOSH|NIOSH|CIDB|guarantee|approved|licen[cs]|award|world-class|leading|best/i;
check("course descriptions: one per catalogue course, 120-155 characters, names TERAS UNIVERSAL and the course, no claims", () => {
  assert(courses.length === 10, `catalogue courses parsed: ${courses.length}`);
  assert(JSON.stringify(Object.keys(courseSeoDescriptions).sort()) === JSON.stringify(courses.map((c) => c.slug).sort()), "slug set");
  for (const { slug, title } of courses) {
    const text = (courseSeoDescriptions as Record<string, string>)[slug];
    assert(text.length >= 120 && text.length <= 155, `${slug}: ${text.length}`);
    assert(text.startsWith(`${title} training by TERAS UNIVERSAL`), `${slug}: lead`);
    assert(!CLAIMS.test(text), `${slug}: claim word`);
  }
});
const coursePage = read("app/training/[slug]/page.js");
check("course titles: absolute '<Course> Training | TERAS UNIVERSAL' (at most 63 characters); canonical and share path kept", () => {
  assert(coursePage.includes("const pageTitle = `${course.title} Training | TERAS UNIVERSAL`;"), "title format");
  assert(coursePage.includes("title: { absolute: pageTitle }") && coursePage.includes("...socialMetadata({ title: pageTitle, description"), "absolute title");
  assert(coursePage.includes("const description = courseSeoDescriptions[course.slug] || course.summary;"), "description fallback");
  assert(coursePage.includes("canonical: `/training/${course.slug}`") && coursePage.includes("path: `/training/${course.slug}`"), "canonical/share");
  for (const { title } of courses) assert(`${title} Training | TERAS UNIVERSAL`.length <= 63, title);
});
check("calendar: search title and description only; the page heading is unchanged", () => {
  const calendar = read("content/en/calendar.js");
  const meta = /meta: \{[\s\S]*?title: "([^"]+)",\s*description: "([^"]+)"/.exec(calendar);
  assert(meta && meta[1] === "Public Training Calendar" && meta[2].length >= 110 && meta[2].length <= 155, "meta");
  assert(/intro: \{[\s\S]*?title: "Training Calendar",/.test(calendar), "heading");
});
check("verify: own share metadata (og:url /verify), canonical and robots rule unchanged", () => {
  const verify = read("app/verify/page.tsx");
  assert(verify.includes('...socialMetadata({ title: `${title} | TERAS UNIVERSAL`, description, path: "/verify" })'), "social");
  assert(verify.includes('alternates: { canonical: "/verify" }'), "canonical");
  assert(verify.includes("robots: hasResult ? { index: false, follow: false } : { index: true, follow: true }"), "robots");
});
check("articles: placeholders left out of the listing only; URLs, noindex and pending status unchanged", () => {
  const listed = insights.filter((item) => Array.isArray(item.body)).map((item) => item.slug);
  const hidden = insights.filter((item) => !Array.isArray(item.body)).map((item) => item.slug);
  assert(JSON.stringify(hidden) === JSON.stringify(["scaffolding-inspection-basics", "confined-space-planning"]), hidden.join(","));
  assert(listed.length === 4 && insights.filter((item) => Array.isArray(item.body)).every((item) => item.reviewStatus === "pending"), "four pending");
  const centre = read("components/InsightsCentre.js");
  assert(centre.includes("const listed = insights.filter((item) => Array.isArray(item.body));"), "listing filter");
  assert(centre.includes('new Set(listed.map(({ category }) => category))') && centre.includes("listed.filter((item) =>"), "filters use the listing");
  const article = read("app/insights/[slug]/page.js");
  assert(/generateStaticParams\(\) \{ return insights\.map\(\(\{ slug \}\) => \(\{ slug \}\)\); \}/.test(article), "every article keeps its URL");
  assert(/robots: \{ index: false, follow: true \}/.test(article), "articles stay noindex");
});

console.log(failures ? `\n${failures} semakan GAGAL` : "\nSemua semakan LULUS");
process.exit(failures ? 1 : 0);
