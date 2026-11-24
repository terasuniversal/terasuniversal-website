import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { insights } from "../data/insights.js";
import { changedSinceBase } from "./contract-base.mts";

// S6 (owner-approved, local only): News & Articles on the existing /insights system, the gated /ebook local preview
// with a mocked request journey, course discovery fixes and navigation. This contract proves the safeguards: the
// eBook route and every link to it are off unless TERAS_EBOOK_PREVIEW=local, no PDF ships with the site, the demo
// form never talks to a backend, marketing consent is optional and separate, and course links resolve.
const root = new URL("../", import.meta.url);
const rootPath = fileURLToPath(root);
const read = (path: string) => readFileSync(new URL(path, root), "utf8").replace(/\r\n/g, "\n");
let failures = 0;
const check = (name: string, fn: () => void) => {
  try { fn(); console.log(`LULUS ${name}`); } catch (error) { failures += 1; console.log(`GAGAL ${name} -> ${(error as Error).message.split("\n")[0]}`); }
};
const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => { const full = join(dir, name); return statSync(full).isDirectory() ? walk(full) : [full]; });

check("eBook gate: flag is TERAS_EBOOK_PREVIEW=local only; route has no paths and rejects dynamic ones when off", () => {
  assert.match(read("lib/ebook-preview.js"), /^export const ebookPreviewEnabled = process\.env\.TERAS_EBOOK_PREVIEW === "local";$/m);
  const page = read("app/ebook/[[...ebook]]/page.js");
  assert.match(page, /^export const dynamicParams = false;$/m);
  assert.match(page, /return ebookPreviewEnabled \? \[\{ ebook: \[\] \}\] : \[\];/);
  assert.match(page, /robots: \{ index: false, follow: false \}/);
  assert.doesNotMatch(read("app/sitemap.js"), /ebook/);
});
check("eBook gate: every link to /ebook lives in EbookPromo, which renders nothing unless the preview flag is on", () => {
  const files = ["app", "components", "content", "data", "lib"].flatMap((dir) => walk(join(rootPath, dir))).filter((file) => /\.(js|jsx|ts|tsx)$/.test(file));
  const linking = files.filter((file) => /href="\/ebook|href=\{?"\/ebook|"\/ebook"\]|\("\/ebook/.test(readFileSync(file, "utf8"))).map((file) => file.slice(rootPath.length).replace(/\\/g, "/"));
  assert.deepEqual(linking, ["components/ebook/EbookPromo.js"]);
  assert.match(read("components/ebook/EbookPromo.js"), /if \(!ebookPreviewEnabled\) return null;/);
  // Code only: content/en/footer.js mentions /ebook in a comment that explains why it is not linked.
  const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code("content/en/footer.js") + code("components/MegaNav.js") + code("components/MobileNav.js"), /\/ebook/);
});
check("eBook PDF: not shipped with the site (no PDF anywhere in public/, no file route), release facts match the approval record", () => {
  const pdfs = walk(join(rootPath, "public")).filter((file) => /\.pdf$/i.test(file) && /ebook|darizero|dunia/i.test(file));
  assert.deepEqual(pdfs, []);
  // W9-G1 (owner-approved): exactly one eBook route, the lead API. It answers 404 before anything else unless
  // TERAS_EBOOK_PUBLIC is exactly "on", and it never serves a file or uses the service role.
  const routes = walk(join(rootPath, "app")).filter((file) => /route\.(js|ts)$/.test(file) && /ebook/i.test(file)).map((file) => file.slice(rootPath.length).replace(/\\/g, "/"));
  assert.deepEqual(routes, ["app/api/ebook/route.js"]);
  const api = read("app/api/ebook/route.js");
  assert.match(api, /export async function POST\(request\) \{\n  if \(!ebookPublicEnabled\(\)\) return new NextResponse\(null, \{ status: 404 \}\);/);
  assert.doesNotMatch(api, /createSupabaseServiceClient|getSupabaseServiceRoleKey|\.pdf|storage\.from|createSignedUrl/);
  const lib = read("lib/ebook-preview.js");
  assert.ok(lib.includes('sha256: "fbf19c283c534e0638bfd91816e7e5b708ee3a8b69a6946612c53a4d570a04dc"'));
  assert.ok(lib.includes('language: "Bahasa Melayu"'));
});
check("eBook cover: rendered from the verified release PDF page 1, 640x907 WebP with no metadata, AI disclosure shown", () => {
  // Public-First release (owner decision, 18 Nov 2026): the cover is withheld from the first public release, so it must not
  // be a public asset at all. The approved cover stays in the work branch and the S6 records; this check then only proves
  // it is not served. When the cover is shipped later, the original byte-level assertions below apply again unchanged.
  if (!existsSync(new URL("public/images/ebook/dari-zero-ke-dunia-industri-cover.webp", root))) {
    assert.equal(existsSync(new URL("public/images/ebook", root)), false, "no eBook asset directory is published");
    assert.match(read("lib/ebook-preview.js"), /export const ebookPreviewEnabled = process\.env\.TERAS_EBOOK_PREVIEW === "local";/);
    return;
  }
  const data = readFileSync(new URL("public/images/ebook/dari-zero-ke-dunia-industri-cover.webp", root));
  assert.equal(createHash("sha256").update(data).digest("hex"), "84df8f13683086525aaa3d8200929a52ce02a491f6f0b8b26627d8d7a7c2c205");
  assert.ok(!data.includes(Buffer.from("EXIF")) && !data.includes(Buffer.from("XMP ")));
  assert.match(read("app/ebook/[[...ebook]]/page.js"), /<figcaption>Cover artwork includes an AI-generated illustration\.<\/figcaption>/);
});
check("eBook demo form: no network or storage, no form action, honest completion text, optional marketing consent unticked", () => {
  const demo = read("components/ebook/EbookRequestDemo.js");
  assert.doesNotMatch(demo, /fetch\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|indexedDB|action=|navigator\.|\/api\//);
  assert.match(demo, /event\.preventDefault\(\);/);
  assert.doesNotMatch(demo, /eBook is ready|download now|has been sent/i);
  assert.match(demo, /Delivery is not active yet\./);
  assert.match(demo, /<input name="marketing" type="checkbox" \/>/, "marketing: no defaultChecked, not required");
  assert.match(demo, /<input name="fulfilment" type="checkbox" required/);
  assert.match(demo, /You will receive the eBook whether or not you tick this\./);
  assert.match(read("app/ebook/[[...ebook]]/page.js"), /Local preview, not live\./);
});
check("News & Articles: existing /insights system reused, labels renamed, real 404 kept, articles stay noindex and out of the sitemap", () => {
  // Public routes only: the admin CMS has its own news module, which S6 does not touch.
  const publicRoutes = walk(join(rootPath, "app")).map((file) => file.slice(rootPath.length).replace(/\\/g, "/")).filter((file) => !/^app\/(admin|api)\//.test(file));
  assert.deepEqual(publicRoutes.filter((file) => /\/(news|articles)\//.test(file)), [], "no second public content system");
  const detail = read("app/insights/[slug]/page.js");
  assert.match(detail, /^export const dynamicParams = false;$/m);
  assert.match(detail, /robots: \{ index: false, follow: true \}/);
  assert.match(detail, /\{ name: "News & Articles", path: "\/insights" \}/);
  assert.match(detail, /"@type": "Article"/);
  assert.doesNotMatch(detail.replace(/^\s*\/\/.*$/gm, ""), /datePublished|dateModified/, "no unverified dates");
  assert.match(read("app/insights/page.js"), /title: "News & Articles"/);
  assert.match(read("components/MegaNav.js"), /\["News & Articles", "\/insights"\]/);
  assert.match(read("components/MobileNav.js"), /\{ label: "News & Articles", href: "\/insights" \}/);
  assert.match(read("content/en/footer.js"), /\["News & Articles", "\/insights"\]/);
  assert.doesNotMatch(read("app/sitemap.js"), /insights\.map|\/insights\//);
});
check("News & Articles data: unique slugs, no invented dates; stubs are labelled in the listing", () => {
  const slugs = insights.map((item) => item.slug);
  assert.equal(new Set(slugs).size, slugs.length);
  for (const item of insights) assert.ok(!("date" in item) && !("publishedAt" in item), item.slug);
  assert.match(read("components/InsightsCentre.js"), /Array\.isArray\(item\.body\) \? item\.readTime : "Full article in preparation"/);
});
check("courses: every related reference resolves to a catalogue course; every article course link exists", () => {
  // data/courseCatalog.js imports an extensionless module, so it is read as text here (as training-catalogue-contract does).
  const catalogue = read("data/courseCatalog.js");
  const slugs = [...catalogue.matchAll(/slug: "([^"]+)"/g)].map((match) => match[1]);
  const related = [...catalogue.matchAll(/^\s*related: \[([^\]]*)\]/gm)].flatMap((match) => [...match[1].matchAll(/"([^"]+)"/g)].map((ref) => ref[1]));
  assert.equal(slugs.length, 10);
  assert.ok(related.length >= 10);
  for (const reference of related) assert.ok(slugs.includes(reference), `related -> ${reference}`);
  const routes = new Set(["/training", "/corporate-training", "/request-proposal", "/calendar", ...slugs.map((slug) => `/training/${slug}`)]);
  for (const item of insights) for (const link of item.relatedCourses || []) assert.ok(routes.has(link.split("?")[0]), `${item.slug} -> ${link}`);
});
check("protected areas untouched by S6: registration, payments, verify, feedback, admin, API, Supabase, globals", () => {
  // Compared with the fixed contract base (committed or not), so the check keeps its meaning after the release commits.
  const changed = changedSinceBase(["app/registration", "app/payments", "app/verify", "app/feedback", "app/api", "lib/payments", "lib/supabase", "supabase", "middleware.ts", "next.config.mjs", "package.json", "package-lock.json"]).join("\n");
  // Pre-S6 entries (Round 1 log changes in app/api) are allowed; S6 adds none. Compared against the S6 preflight list.
  const allowed = new Set([" M app/api/contact/route.js", " M app/api/newsletter/route.js", " M app/api/request-proposal/route.js",
    // Public-First release (K-4): only the generic, read-only payment return page (G-2) and its view module ship; the
    // ToyyibPay R2/R4 callback, library and decision changes are excluded and must not appear here.
    " M app/payments/toyyibpay/return/page.tsx", "?? lib/payments/toyyibpay-return-view.ts",
    // Public-First launch fixes (owner-approved): F-1 kill switch and F-4 /verify contrast; scripts/public-first-launch-contract.mts.
    " M app/api/registration/payment/route.ts", " M app/api/registration/route.ts", " M app/registration/[scheduleId]/page.tsx", " M app/verify/VerificationResult.tsx", " M app/verify/page.tsx",
    // W9-G1 (owner-approved): the eBook lead API, 404 unless TERAS_EBOOK_PUBLIC is "on" (checked above).
    "?? app/api/ebook/route.js"]);
  for (const line of changed.split("\n").filter(Boolean)) assert.ok(allowed.has(line), line);
});

console.log(failures ? `\n${failures} semakan GAGAL` : "\nSemua semakan LULUS");
process.exit(failures ? 1 : 0);
