/**
 * W6-SEO-a2 editorial contract (owner-approved W6-SEO-a2 G1, local only). Proves the named edits in
 * scripts/w6a2-approved.mts are the only change to data/insights.js, that each complete article's readTime follows one
 * measure (body words / 200 per minute, rounded up), that the Oil & Gas meta description fits a search snippet, that the
 * new CTAs point to pages that exist, and that every article is still unreviewed, undated, unattributed and noindex.
 *
 * Run: node --experimental-transform-types scripts/w6a2-editorial-contract.mts
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { revertW6a2, W6A2_CHANGED } from "./w6a2-approved.mts";
import { insights } from "../data/insights.js";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const read = (p: string) => readFileSync(path.join(root, p), "utf8");
const sha256 = (text: string) => createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex");
let failures = 0;
const check = (name: string, fn: () => void) => {
  try { fn(); console.log(`LULUS ${name}`); } catch (error) { failures += 1; console.log(`GAGAL ${name} -> ${(error as Error).message.split("\n")[0]}`); }
};
const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };

// SHA-256 (LF-normalised) at main b597a353, before W6-SEO-a2.
const BEFORE: Record<string, string> = {
  "data/insights.js": "159251bacae5830e1236f7552771912eac4ef2347c63d7b6558340a89d61dcac",
};
// Untouched: article routes, listing, sitemap and robots (indexing behaviour stays exactly as on main).
const UNCHANGED: Record<string, string> = {
  "app/insights/[slug]/page.js": "885cb667d1a1d518461242d4c0d34a873897f23a01667fac01993f1fc184dc3f",
  "app/insights/page.js": "387b732f96a11cdf300638b055e5e9c651ef71776e9e22e0c0e9ff6d6d417b86",
  "app/sitemap.js": "786a2716b24488830905e615e68c9ea453b9661be03f653c75d14dd2d0987baa",
  "app/robots.js": "b8885739b9c70d240b9ed222f436c7524cae77ca1b396811764fea26ab5ff19c",
  "components/InsightsCentre.js": "8c5083e41775929d2b63dfd878b6059c8ed19f8bf23194c29a9686efc6fdcbaa",
};
const EXPECTED_MINUTES: Record<string, number> = {
  "working-at-height-risk-awareness": 6,
  "competency-based-training": 4,
  "oil-and-gas-workforce-readiness": 6,
  "training-needs-analysis": 5,
};
const PLACEHOLDERS = ["scaffolding-inspection-basics", "confined-space-planning"];

type Item = Record<string, unknown> & { slug: string };
const items = insights as unknown as Item[];
const complete = items.filter((item) => Array.isArray(item.body));
const strings = (v: unknown): string[] =>
  typeof v === "string" ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === "object" ? Object.values(v).flatMap(strings) : [];
const words = (item: Item) => strings(item.body).join(" ").split(/\s+/).filter(Boolean).length;

check("scope: only data/insights.js carries W6-SEO-a2 named edits", () => {
  assert(JSON.stringify(W6A2_CHANGED) === JSON.stringify(Object.keys(BEFORE)), W6A2_CHANGED.join(", "));
});
check("integrity: reverting the named edits restores data/insights.js exactly (nothing else changed)", () => {
  for (const [p, hash] of Object.entries(BEFORE)) assert(sha256(revertW6a2(p, read(p))) === hash, p);
});
check("unchanged: article route, listing, sitemap, robots and InsightsCentre", () => {
  for (const [p, hash] of Object.entries(UNCHANGED)) assert(sha256(read(p)) === hash, p);
});
check("readTime: each complete article = ceil(body words / 200) minutes", () => {
  assert(complete.length === 4, `complete=${complete.length}`);
  for (const item of complete) {
    const minutes = Math.ceil(words(item) / 200);
    assert(minutes === EXPECTED_MINUTES[item.slug], `${item.slug}: ${minutes}`);
    assert(item.readTime === `${minutes} min read`, `${item.slug}: ${String(item.readTime)}`);
  }
});
check("meta: Oil & Gas description is 120-155 characters and keeps its subject", () => {
  const og = complete.find((item) => item.slug === "oil-and-gas-workforce-readiness")!;
  const meta = String(og.metaDescription);
  assert(meta.length >= 120 && meta.length <= 155, `length ${meta.length}`);
  assert(/Oil & Gas workforce readiness/.test(meta) && /competency/.test(meta), "subject");
});
check("cta: competency and TNA name existing pages; WAH and O&G CTAs unchanged (integrity)", () => {
  const cta = (slug: string) => { const i = complete.find((item) => item.slug === slug)!; return [i.ctaLabel, i.ctaHref]; };
  assert(JSON.stringify(cta("competency-based-training")) === JSON.stringify(["Discuss a Competency-Based Training Plan", "/corporate-training"]), "competency");
  assert(JSON.stringify(cta("training-needs-analysis")) === JSON.stringify(["Request a Training Proposal", "/request-proposal"]), "tna");
  for (const item of complete.filter((i) => ["competency-based-training", "training-needs-analysis"].includes(i.slug))) {
    const href = String(item.ctaHref);
    assert(href.startsWith("/") && existsSync(path.join(root, "app", href.slice(1), "page.js")), `${item.slug}: ${href}`);
  }
});
check("review: every complete article stays pending, undated and unattributed", () => {
  for (const item of complete) {
    assert(item.reviewStatus === "pending", `${item.slug}: ${String(item.reviewStatus)}`);
    for (const key of ["date", "publishedAt", "datePublished", "updatedAt", "author"]) assert(!(key in item), `${item.slug}: ${key}`);
  }
});
check("noindex: the article route still declares index:false for every article", () => {
  assert(read("app/insights/[slug]/page.js").includes("robots: { index: false, follow: true }"), "robots");
});
check("placeholders: two body-less entries stay hidden and untouched", () => {
  const hidden = items.filter((item) => !Array.isArray(item.body)).map((item) => item.slug);
  assert(JSON.stringify(hidden) === JSON.stringify(PLACEHOLDERS), hidden.join(", "));
  for (const item of items.filter((i) => PLACEHOLDERS.includes(i.slug))) {
    assert(JSON.stringify(Object.keys(item)) === JSON.stringify(["slug", "category", "title", "excerpt", "readTime"]), item.slug);
  }
});

console.log(failures ? `\n${failures} GAGAL` : "\nSemua LULUS");
process.exit(failures ? 1 : 0);
