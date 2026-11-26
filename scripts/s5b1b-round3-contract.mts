import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { socialMetadata, SOCIAL_IMAGE, TWITTER_IMAGE } from "../lib/social-metadata.js";
import { revertPublicFirst, PF_CHANGED, PF_ADDED, PF_WITHHELD } from "./public-first-approved.mts";
import { CONTRACT_BASE, changedSinceBase } from "./contract-base.mts";
import { approvedRootLoading } from "./w10ux-approved.mts"; // W10-UX-01: root loading boundary moved to /calendar

// S5B-1B Round 3 (owner-approved, local only): hard 404 for unknown industry slugs, per-page social metadata, the
// V2 bridge on legacy-bodied informational pages, AI-image disclosure and the re-rendered share image.
const root = new URL("../", import.meta.url);
const rootPath = fileURLToPath(root);
const read = (path: string) => readFileSync(new URL(path, root), "utf8").replace(/\r\n/g, "\n");
let failures = 0;
const check = (name: string, fn: () => void) => {
  try { fn(); console.log(`LULUS ${name}`); } catch (error) { failures += 1; console.log(`GAGAL ${name} -> ${(error as Error).message.split("\n")[0]}`); }
};

check("industries: unknown slugs are rejected by the router; every data slug is still generated", () => {
  const page = read("app/industries/[slug]/page.js");
  assert.match(page, /^export function generateStaticParams\(\) \{ return industries\.map\(\(\{ slug \}\) => \(\{ slug \}\)\); \}$/m);
  assert.match(page, /^export const dynamicParams = false;$/m);
  assert.equal(approvedRootLoading(root), execFileSync("git", ["show", `${CONTRACT_BASE}:app/loading.js`], { cwd: rootPath, encoding: "utf8" }).replace(/\r\n/g, "\n"));
});

const SOCIAL = {
  "app/industries/page.js": ['"/industries"', '"/industries"'],
  "app/industries/[slug]/page.js": ["`/industries/${industry.slug}`", "`/industries/${industry.slug}`"],
  "app/resources/page.js": ['"/resources"', '"/resources"'],
  "app/faq/page.js": ['"/faq"', '"/faq"'],
  "app/stories/page.js": ['"/stories"', '"/stories"'],
  "app/insights/page.js": ['"/insights"', '"/insights"'],
  "app/insights/[slug]/page.js": ["`/insights/${item.slug}`", "`/insights/${item.slug}`"],
  "app/request-proposal/layout.js": ['"/request-proposal"', '"/request-proposal"'],
  "app/calendar/page.js": ['"/calendar"', '"/calendar"'],
  "app/search/page.js": ['"/search"', '"/search"'],
  "app/corporate-training/page.js": ['"/corporate-training"', '"/corporate-training"'],
  "app/training/[slug]/page.js": ["`/training/${course.slug}`", "`/training/${course.slug}`"],
  "app/training/scaffolding-competency/layout.js": ['"/training/scaffolding-competency"', '"/training/scaffolding-competency"'],
};
check("social metadata: each page's share URL is its own canonical path (no inherited homepage og:url)", () => {
  for (const [path, [canonical, share]] of Object.entries(SOCIAL)) {
    const source = read(path);
    assert.ok(source.includes(`canonical: ${canonical}`), `${path}: canonical`);
    assert.ok(source.includes(`path: ${share}`), `${path}: social path`);
    assert.match(source, /\.\.\.socialMetadata\(\{ title: /, path);
    assert.doesNotMatch(source, /openGraph: \{/, `${path}: no partial openGraph left`);
  }
});
check("social metadata helper: own url, title, description and the share image for Open Graph and Twitter", () => {
  const meta = socialMetadata({ title: "T", description: "D", path: "/x" });
  assert.equal(meta.openGraph.url, "/x");
  assert.equal(meta.openGraph.title, "T");
  assert.deepEqual(meta.openGraph.images, [SOCIAL_IMAGE]);
  assert.equal(SOCIAL_IMAGE.url, "/opengraph-image.png");
  assert.equal(SOCIAL_IMAGE.width, 1200);
  assert.equal(SOCIAL_IMAGE.height, 630);
  assert.deepEqual(meta.twitter.images, [TWITTER_IMAGE]);
  assert.equal(socialMetadata({ title: "A", description: "B", path: "/y", type: "article" }).openGraph.type, "article");
});
check("draft legal pages and protected routes are untouched by the social metadata", () => {
  for (const path of ["app/privacy/[[...lang]]/page.js", "app/terms/[[...part]]/page.js", "app/layout.js"]) assert.doesNotMatch(read(path), /socialMetadata/, path);
});

const BRIDGED = ["app/about/page.js", "app/services/page.js", "app/services/scaffolding/page.js", "app/corporate-training/page.js", "app/contact/page.js", "app/request-proposal/page.js", "app/request-proposal/success/page.js", "app/faq/page.js", "app/gallery/page.js", "app/industries/page.js", "app/industries/[slug]/page.js", "app/insights/page.js", "app/insights/[slug]/page.js", "app/resources/page.js", "app/search/page.js", "app/stories/page.js"];
check("visual bridge: applied to the 16 legacy-bodied informational pages only, on their own <main>", () => {
  for (const path of BRIDGED) assert.match(read(path), /<main className=\{`[^`]+ \$\{bridge\.page\} \$\{publicBody\.variable\}`\}>/, path);
  const users = execFileSync("git", ["grep", "-l", "--untracked", "legacy-bridge.module.css", "--", "app", "components"], { cwd: rootPath, encoding: "utf8" }).trim().split("\n").sort();
  assert.deepEqual(users, [...BRIDGED].sort());
});
// Round 4 adds #b3261e, the site's existing field-error red (globals .form-field-error); the Round 4 contract pins it
// to the contact form error selector only.
check("visual bridge: scoped to .page, approved palette only, no admin/certificate/registration selectors", () => {
  const css = read("components/premium/legacy-bridge.module.css").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const rule of css.split("}").map((r) => r.trim()).filter(Boolean)) assert.match(rule, /^\.(page|aiNote)\b/, rule.slice(0, 60));
  for (const colour of css.match(/#[0-9a-f]{3,6}\b/gi) ?? []) assert.ok(["#0b3a63", "#072a48", "#d4af37", "#333333", "#4f5b6a", "#ffffff", "#b3261e"].includes(colour.toLowerCase()), colour);
  assert.doesNotMatch(css, /teras-admin|verify|certificate|registration|feedback|payment|@import|@font-face/i);
});

const NOTE = "AI-generated illustration for visual representation.";
check("AI disclosure: /about hero and the homepage delivery image are captioned and their alt text says so", () => {
  const about = read("app/about/page.js");
  assert.ok(about.includes(`<figcaption className={bridge.aiNote}>${NOTE}</figcaption>`));
  assert.match(about, /alt="AI-generated illustration: an instructor briefing six trainees/);
  const delivery = read("components/home/DeliveryOptions.js");
  assert.ok(delivery.includes(`<figcaption className={styles.aiNote}>${NOTE}</figcaption>`));
  assert.match(delivery, /alt="AI-generated illustration: an instructor holds up a scaffold coupler/);
  assert.match(read("components/home/home.module.css"), /^\.wide \.aiNote \{/m);
  // Already disclosed before this round and kept: homepage hero caption, /training caption, /gallery intro, footer note.
  assert.match(read("components/home/HomeHero.js"), /AI-generated illustration/);
  assert.match(read("app/gallery/page.js"), /These are AI-generated illustrations/);
  assert.match(read("content/en/footer.js"), /AI-generated illustrations/);
});
// S5C: the poster (provenance still unknown) is withdrawn from public pages and replaced by authentic TERAS photographs;
// it is never labelled AI, and neither are the photographs. The file itself is kept byte-identical for the record.
check("AI disclosure: the scaffolding poster (provenance unknown) is not labelled as AI", () => {
  for (const path of ["app/services/page.js", "app/services/scaffolding/page.js"]) {
    const source = revertPublicFirst(path, read(path)); // Public-First F-2 panels reverted to the S5C figures
    assert.doesNotMatch(read(path), /scaffolding-rental-poster-en\.webp/, `${path}: poster withdrawn in S5C`);
    assert.match(source, /\/images\/authentic\/teras-yard-/, `${path}: authentic photograph`);
    assert.doesNotMatch(source, /AI-generated/, path);
  }
  // Public-First F-3: the poster left public/; its committed blob (the evidence in git history) must still be byte-identical.
  const poster = PF_WITHHELD.includes("public/images/scaffolding-rental-poster-en.webp") ? execFileSync("git", ["show", `${CONTRACT_BASE}:public/images/scaffolding-rental-poster-en.webp`], { cwd: fileURLToPath(root), maxBuffer: 1 << 26 }) : readFileSync(new URL("public/images/scaffolding-rental-poster-en.webp", root));
  assert.equal(createHash("sha256").update(poster).digest("hex"), "8f1a85afefc5c96fdec8d374f91365b913cf262e90c4ee394a8ce2fe83c38363");
});

const png = (path: string) => readFileSync(new URL(path, root));
check("share image: re-rendered 1200 x 630 PNG, same file for Open Graph and Twitter, original replaced", () => {
  for (const path of ["app/opengraph-image.png", "app/twitter-image.png"]) {
    const data = png(path);
    assert.equal(data.subarray(1, 4).toString("latin1"), "PNG", path);
    assert.equal(data.readUInt32BE(16), 1200, `${path} width`);
    assert.equal(data.readUInt32BE(20), 630, `${path} height`);
  }
  const sha = (path: string) => createHash("sha256").update(png(path)).digest("hex");
  assert.equal(sha("app/opengraph-image.png"), sha("app/twitter-image.png"));
  assert.notEqual(sha("app/opengraph-image.png"), "2ae42e25cfb878bf6cc9531d5a8b064ee13965c44cf03ea74a42ee9b4298b147", "still the truncated original");
});

console.log(failures ? `\n${failures} semakan GAGAL` : "\nSemua semakan LULUS");
process.exit(failures ? 1 : 0);
