import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { footerContent } from "../content/en/footer.js";
import { publicContact } from "../data/publicContact.js";
import { brand, companyProfile } from "../data/companyProfile.js";
import { revertPublicFirst, PF_CHANGED, PF_ADDED, PF_WITHHELD } from "./public-first-approved.mts";
import { CONTRACT_BASE, changedSinceBase } from "./contract-base.mts";

// Phase S4D-2D (owner-approved): the Premium footer. components/Footer.js is also rendered by the registration page,
// the 404 page and the dead app/verify/page.js, so the Premium footer is a separate component used only by the approved
// informational routes, and the shared footer stays byte-for-byte as it was. Proves the logo, contact details and
// slogan come from the verified sources, every link points at a route that exists, and no policy, eBook or placeholder
// link is introduced.
const root = new URL("../", import.meta.url);
const rootPath = fileURLToPath(root);
const read = (path: string) => readFileSync(new URL(path, root), "utf8").replace(/\r\n/g, "\n");
const atHead = (path: string) => execFileSync("git", ["show", `${CONTRACT_BASE}:${path}`], { cwd: rootPath, encoding: "utf8" }).replace(/\r\n/g, "\n");
let failures = 0;
const check = (name: string, fn: () => void) => {
  try { fn(); console.log(`LULUS ${name}`); } catch (error) { failures += 1; console.log(`GAGAL ${name} -> ${(error as Error).message.split("\n")[0]}`); }
};

const footer = read("components/premium/PremiumFooter.js");
const css = read("components/premium/footer.module.css");
const content = read("content/en/footer.js");
const APPROVED = ["app/page.js", "app/training/page.js", "app/training/[slug]/page.js", "app/training/scaffolding-competency/page.js", "app/calendar/page.js", "app/about/page.js", "app/services/page.js", "app/corporate-training/page.js", "app/services/scaffolding/page.js", "app/industries/page.js", "app/industries/[slug]/page.js", "app/resources/page.js", "app/faq/page.js", "app/gallery/page.js", "app/stories/page.js", "app/search/page.js", "app/contact/page.js", "app/request-proposal/page.js", "app/insights/page.js",
  // S5B-1B Round 1 (owner-approved): the article page, the proposal success page and the 404 page.
  "app/insights/[slug]/page.js", "app/request-proposal/success/page.js", "app/not-found.js",
  // S5B-1B Round 2: the local-only draft legal pages (gated by TERAS_LEGAL_DRAFTS, noindex).
  "app/privacy/[[...lang]]/page.js", "app/terms/[[...part]]/page.js",
  // S6: the local-preview eBook landing page (gated by TERAS_EBOOK_PREVIEW, noindex).
  "app/ebook/[[...ebook]]/page.js"];
const LEGACY = ["app/registration/[scheduleId]/page.tsx", "app/verify/page.js"];

check("logo: the official white vector from the logo pack, whole, at its intrinsic ratio, served as is", () => {
  assert.match(footer, /const LOGO_SRC = "\/brand\/teras-universal-logo-white\.svg";/);
  assert.match(footer, /<Image src=\{LOGO_SRC\} alt=\{text\.logoAlt\} width=\{1184\} height=\{847\} unoptimized \/>/);
  assert.equal(footerContent.logoAlt, "TERAS UNIVERSAL");
  assert.match(read("scripts/premium-header-contract.mts"), /teras-universal-logo-white\.svg/);
  assert.match(css, /\.logo img \{[^}]*height: 96px; width: auto; max-width: none; object-fit: contain;/);
  assert.doesNotMatch(css, /\.logo img \{[^}]*\bwidth: \d/);
});
check("server component: no client JavaScript added", () => assert.doesNotMatch(footer, /["']use client["']|useState|useEffect/));
check("identity: company name and slogan match the verified company profile", () => {
  assert.equal(footerContent.company, companyProfile.name);
  assert.equal(footerContent.slogan, brand.tagline);
  assert.equal(footerContent.slogan, "Building Competence. Creating Opportunities.");
});
check("contact: owner-confirmed email, phone and website; email and tel: number from the shared contact source", () => {
  assert.equal(publicContact.email, "admin@terasuniversal.com.my");
  assert.match(footer, /href=\{`mailto:\$\{email\}`\}/);
  assert.match(footer, /const tel = phone\.replace\(\/\[\^\+\\d\]\/g, ""\);/);
  assert.equal(publicContact.phone.replace(/[^+\d]/g, ""), "+60195193834");
  assert.equal(footerContent.contact.phoneDisplay, "019-519 3834");
  assert.equal(footerContent.contact.website, "www.terasuniversal.com.my");
  assert.ok(!footer.includes("training@") && !content.includes("training@"), "no training@ literal");
});
check("links: every footer destination is an existing route (and every #anchor exists on its page)", () => {
  const hrefs = [...footerContent.groups.flatMap((group) => group.links.map(([, href]) => href))];
  assert.ok(hrefs.length >= 10);
  for (const href of hrefs) {
    const [path, hash] = href.split("#");
    const page = path === "/" ? "app/page.js" : `app${path}/page.js`;
    assert.ok(existsSync(new URL(page, root)) || existsSync(new URL(page.replace(/\.js$/, ".tsx"), root)), `${href}: no route`);
    if (hash) assert.match(read(page), new RegExp(`\\["${hash}", `), `${href}: anchor id not found`);
  }
  assert.equal(new Set(hrefs).size, hrefs.length, "duplicate destination");
  assert.equal(footerContent.actions.whatsapp.href, "https://wa.me/60195193834");
});
check("links: no policy, eBook, placeholder or invented destination", () => {
  // Code only: the comments in these files document that no policy page is linked.
  const code = (content + footer).replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(code, /privacy|terms|policy|pdpa|cookie|\/ebook|href="#"|href: "#"|"#"\]/i);
});
check("statements: only the existing copyright and AI-imagery note, no new legal or compliance claim", () => {
  const before = atHead("components/Footer.js");
  assert.ok(before.includes("&copy; 2026 TERAS UNIVERSAL SDN. BHD. All rights reserved."));
  // S5B-1B Round 1: same wording, year supplied at render time (Malaysia time) instead of hard-coded.
  assert.equal(typeof footerContent.copyright, "function");
  assert.equal(footerContent.copyright("2026"), "© 2026 TERAS UNIVERSAL SDN. BHD. All rights reserved.");
  assert.match(footer, /timeZone: "Asia\/Kuala_Lumpur"/);
  assert.match(footer, /\{text\.copyright\(year\)\}/);
  assert.doesNotMatch(footer, /"use client"/);
  assert.ok(read("components/Footer.js").includes(footerContent.aiNote));
  assert.doesNotMatch(content, /DOSH|JKKP|CIDB|NIOSH|HRD ?Corp|accredit|certified|approved by|ISO \d/i);
});
check("accessibility: labelled navigation groups with headings, an address element, new-tab notice, no extra <main>", () => {
  assert.match(footer, /<nav className=\{styles\.group\} aria-labelledby=\{group\.id\}/);
  assert.match(footer, /<h2 id=\{group\.id\}/);
  assert.match(footer, /<address className=\{styles\.contact\}>/);
  assert.match(footer, /target="_blank" rel="noreferrer"[\s\S]*?className="sr-only"/);
  assert.doesNotMatch(footer, /<main\b/);
  assert.match(css, /\.footer a:focus-visible \{ outline: 3px solid var\(--px-white\)/);
});
check("visibility: the footer link groups override the legacy global nav rule that hides every <nav> below 921px", () => {
  assert.match(read("app/globals.css"), /@media \(max-width: ?920px\)\s*\{[^}]*\bnav\s*\{\s*display:\s*none/);
  assert.match(css, /^\.grid \.group \{ display: block;/m);
  assert.doesNotMatch(css, /@media[^{]*\{[^}]*\.grid \.group \{[^}]*display: none/);
});
check("scope: the approved informational routes use PremiumFooter exactly once and no longer import the shared footer", () => {
  const out = execFileSync("git", ["grep", "-l", "--untracked", "components/premium/PremiumFooter", "--", "app", "components"], { cwd: rootPath, encoding: "utf8" });
  assert.deepEqual(out.trim().split("\n").sort(), [...APPROVED].sort());
  for (const path of APPROVED) {
    const page = read(path);
    assert.equal((page.match(/<PremiumFooter \/>/g) ?? []).length, 1, path);
    assert.doesNotMatch(page, /components\/Footer"|<Footer \/>/, path);
  }
});
check("landmarks (S5B-1B Round 2): on every approved route the footer sits after </main>, never inside it", () => {
  for (const path of APPROVED) {
    const page = read(path);
    assert.match(page, /<\/main>\s*<PremiumFooter \/>/, path);
    // Comments may mention <main>, and a page may have an early "not found" return with its own <main>; each render
    // still has exactly one.
    const code = page.replace(/^\s*\/\/.*$/gm, "").replace(/^\s*if \([^)]*\) return <main[\s\S]*?<\/main>;$/gm, "");
    assert.equal((code.match(/<main\b/g) ?? []).length, 1, `${path}: one <main>`);
  }
});
check("scope: registration and the dead verify page keep the shared footer and are unchanged against HEAD", () => {
  const out = execFileSync("git", ["grep", "-l", "--untracked", 'components/Footer"', "--", "app"], { cwd: rootPath, encoding: "utf8" });
  assert.deepEqual(out.trim().split("\n").sort(), [...LEGACY].sort());
  // Public-First launch fixes (owner-approved): revertPublicFirst() undoes only those named edits (scripts/public-first-approved.mts),
  // so this check still proves everything else is exactly what it approved; scripts/public-first-launch-contract.mts covers the fixes.
  for (const path of LEGACY) assert.equal(revertPublicFirst(path, read(path)), atHead(path), path);
});
check("the shared footer is untouched by this phase (blob hash recorded in the S4D-2A/2D preflight)", () => {
  assert.equal(execFileSync("git", ["hash-object", "components/Footer.js"], { cwd: rootPath, encoding: "utf8" }).trim(), "7b63674a24674cfec55cba90e02645658e35ee5d");
});

console.log(failures ? `\n${failures} semakan GAGAL` : "\nSemua semakan LULUS");
process.exit(failures ? 1 : 0);
