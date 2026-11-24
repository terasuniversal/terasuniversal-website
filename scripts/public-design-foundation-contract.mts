import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONTRACT_BASE, changedSinceBase } from "./contract-base.mts";
import { revertPublicFirst, PF_CHANGED, PF_ADDED, PF_WITHHELD } from "./public-first-approved.mts";
import { revertW4a, W4A_CHANGED } from "./w4a-approved.mts";
import { W9G3_PROTECTED_ADDED } from "./w9g3-approved.mts"; // W9-G3.3: the two exact W9-G3 API route files

// Contract for the scoped public design foundation (Phase S1): components/premium/premium.module.css and fonts.js.
// Proves the kit cannot reach the admin/CRM shell, certificate pages or the attendance print layout, and that the
// global brand tokens are untouched. Static analysis of repository files only.
const rootPath = fileURLToPath(new URL("../", import.meta.url));
const read = (path: string) => readFileSync(join(rootPath, path), "utf8");
let failures = 0;
const check = (name: string, fn: () => void) => {
  try { fn(); console.log(`LULUS ${name}`); } catch (error) { failures += 1; console.log(`GAGAL ${name} -> ${(error as Error).message.split("\n")[0]}`); }
};

const css = read("components/premium/premium.module.css");
const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
// Top-level selectors (media query wrappers removed), one entry per comma-separated selector.
const selectors = stripped
  .replace(/@media[^{]+\{([\s\S]*?\})\s*\}/g, "$1")
  .split("}")
  .map((block) => block.split("{")[0].trim())
  .filter(Boolean)
  // split on commas outside parentheses, so ":where(h1, h2)" stays part of its selector
  .flatMap((selector) => selector.split(/,(?![^(]*\))/).map((part) => part.trim()));

// ---- isolation ------------------------------------------------------------------
// A selector may start with a local class, or with :where(.localClass) for the zero-specificity root block.
check("css: every selector starts with a local class (no element, :root, html, body or * at top level)", () => {
  assert.ok(selectors.length > 10);
  for (const selector of selectors) assert.match(selector, /^(\.[A-Za-z]|:where\(\.[A-Za-z][\w-]*\))/, selector);
});
check("css: the kit root sets no background, so it never paints over a component's own ground", () => {
  const root = /:where\(\.px\)\s*\{([^}]*)\}/.exec(stripped)?.[1] ?? "";
  assert.ok(root.length > 0, "root block present");
  assert.ok(!/(^|[\s;])background(-color)?\s*:/.test(root), "background in root");
});
check("css: no :global escape hatch", () => assert.ok(!/:global/.test(stripped)));
check("css: no @font-face, @import or url() (no font or asset download)", () => assert.ok(!/@font-face|@import|url\(/.test(stripped)));
check("css: custom properties are declared only with the --px- prefix", () => {
  const declared = [...stripped.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]);
  assert.ok(declared.length > 0);
  for (const name of declared) assert.ok(name.startsWith("--px-"), name);
});
check("css: does not redefine the global --navy / --gold / --ink tokens", () => assert.ok(!/(^|[\s;{])--(navy|gold|ink|muted|soft|line)\s*:/.test(stripped)));
check("css: owner-approved brand values", () => {
  assert.match(stripped, /--px-navy:\s*#0b3a63/i);
  assert.match(stripped, /--px-gold:\s*#d4af37/i);
  assert.match(stripped, /--px-white:\s*#ffffff/i);
  assert.match(stripped, /--px-ink:\s*#333333/i);
});
check("css: headings Montserrat, body Inter (self-hosted variables)", () => {
  assert.match(stripped, /--px-font-heading:\s*var\(--font-montserrat\)/);
  assert.match(stripped, /--px-font-body:\s*var\(--font-public-body\)/);
});
check("css: focus is visible (outline plus contrasting halo)", () => assert.match(stripped, /\.px :focus-visible \{[^}]*outline: 3px solid var\(--px-navy\)[^}]*box-shadow: 0 0 0 6px var\(--px-gold\)/));

// ---- global tokens and other surfaces untouched ----------------------------------
check("globals.css still defines the existing brand tokens", () => {
  const globals = read("app/globals.css");
  assert.match(globals, /--navy:#0B2C56/);
  assert.match(globals, /--gold:#E1A925/);
  // globals.css already has unrelated legacy ".premium-*" classes; what matters is that it never pulls in the kit or its tokens.
  assert.ok(!/premium\.module|components\/premium|--px-/.test(globals), "globals.css must not reference the public kit");
});
check("attendance print layout still resolves var(--navy) from the global tokens", () =>
  assert.ok(read("app/admin/(protected)/attendance/[scheduleId]/print/page.tsx").includes("var(--navy)")));

const walk = (dir: string): string[] => readdirSync(join(rootPath, dir)).flatMap((name) => {
  const path = `${dir}/${name}`;
  return statSync(join(rootPath, path)).isDirectory() ? walk(path) : [path];
});
const sourceFiles = ["app", "components", "lib"].flatMap(walk).filter((path) => /\.(js|jsx|ts|tsx|css)$/.test(path));
// An importer is a file with an actual import statement that resolves into components/premium/ (comments that merely
// mention the kit's path do not count).
const importsKit = (source: string) => /(?:from\s+|import\s+)["'][^"']*\/premium\/[^"']+["']/.test(source);
const importers = sourceFiles.filter((path) => !path.startsWith("components/premium/") && importsKit(read(path))).sort();
// Phase S2B: the homepage is the only page that uses the kit (owner brief S2B). Any other importer is a scope change.
// Phase S3 (owner brief S3 §3B): the homepage "Next public sessions" section (components/home/UpcomingDates.js) joins it.
// Phase S4A (owner brief S4A §3): the Training Calendar page and its TrainingCalendar component join it.
// Phase S4B (owner brief S4B §3): the course-detail page and its session cards (components/course/) join it.
// Phase S4C (owner brief S4C §3): the training catalogue page, its course catalogue and the finder and comparison it uses.
// Phase S4C-1 (owner Option A): the Scaffolding Training category page.
// Phase S4D-2A (owner-approved header pilot): /about, /services and /corporate-training import PremiumHeader only.
// Phase S4D-2B (owner-approved header rollout): eight more content routes import PremiumHeader only.
// Phase S4D-2C (owner-approved): /contact, /request-proposal, /request-proposal/success and /insights import PremiumHeader only.
// S5B-1B Round 1 (owner-approved): /insights/[slug] (Premium header + footer) and the 404 page (Premium footer) join it.
// S5B-1B Round 2: the local-only draft legal pages and their LegalDocument component join it.
check("kit is imported only by the homepage, the training calendar, the course pages, the training catalogue, the scaffolding category, the header-rollout content and lead pages and their own components", () =>
  assert.deepEqual(importers, ["app/about/page.js", "app/calendar/page.js", "app/contact/page.js", "app/corporate-training/page.js", "app/ebook/[[...ebook]]/page.js" /* S6 local-preview eBook page */, "app/ebook/verify/[[...verify]]/page.js" /* W9-G3 eBook verification page (W9-G3.2) */, "app/faq/page.js", "app/gallery/page.js", "app/industries/[slug]/page.js", "app/industries/page.js", "app/insights/[slug]/page.js", "app/insights/page.js", "app/not-found.js", "app/page.js", "app/privacy/[[...lang]]/page.js", "app/request-proposal/page.js", "app/request-proposal/success/page.js", "app/resources/page.js", "app/search/page.js", "app/services/page.js", "app/services/scaffolding/page.js", "app/stories/page.js", "app/terms/[[...part]]/page.js", "app/training/[slug]/page.js", "app/training/page.js", "app/training/scaffolding-competency/page.js", "components/TrainingCalendar.js", "components/TrainingComparison.js", "components/TrainingFinder.js", "components/course/CourseSessions.tsx", "components/home/CoreProgrammes.js", "components/home/HomeHero.js", "components/home/UpcomingDates.js", "components/legal/LegalDocument.js", "components/training/CourseCatalogue.js"]));
check("admin, certificate, verification and registration code never import the kit", () => {
  for (const path of sourceFiles.filter((file) => /^(app\/admin|components\/admin|app\/verify|app\/registration|components\/public)/.test(file))) {
    assert.ok(!importsKit(read(path)) && !/premium\.module\.css|header\.module\.css/.test(read(path)), path);
  }
});

// ---- header module: :global only inside the local .hdr scope ---------------------
const headerCss = read("components/premium/header.module.css").replace(/\/\*[\s\S]*?\*\//g, "");
const headerSelectors = headerCss
  .replace(/@media[^{]+\{([\s\S]*?\})\s*\}/g, "$1")
  .split("}")
  .map((block) => block.split("{")[0].trim())
  .filter(Boolean)
  .flatMap((selector) => selector.split(/,(?![^(]*\))/).map((part) => part.trim()));
check("header css: every selector starts with a local class", () => {
  assert.ok(headerSelectors.length > 20);
  for (const selector of headerSelectors) assert.match(selector, /^\.[A-Za-z]/, selector);
});
// S2D: strict again. The S2C allowance for ".hdr.<modifier>" (Option B, now removed) is withdrawn: :global() may appear
// only after the plain ".hdr " scope.
check("header css: :global() appears only under the local .hdr scope", () => {
  const scoped = headerSelectors.filter((s) => s.includes(":global"));
  assert.ok(scoped.length > 10);
  for (const selector of scoped) assert.match(selector, /^\.hdr :global\(/, selector);
});
check("header css: the global classes it restyles are only the existing navigation components", () => {
  const targets = new Set([...headerCss.matchAll(/:global\(([^)]+)\)/g)].map((m) => m[1].trim()));
  const allowed = new Set([".mega-nav", ".mega-nav-group", ".mega-nav-group[open]", ".mega-nav-verify", ".mega-nav-panel", ".is-active", ".nav-proposal", ".nav-cta", ".menu-button", ".menu-button.is-open", ".contact-button", ".contact-button.is-open", ".mobile-menu", ".mobile-menu.open", ".mobile-menu-heading", ".mobile-menu-cta", ".mobile-contact"]);
  for (const target of targets) assert.ok(allowed.has(target), `unexpected global target ${target}`);
});
check("header css: no Option B (light) variant remains", () => assert.ok(!/\.light\b/.test(headerCss)));

// ---- homepage modules that use the kit -------------------------------------------
const selectorsOf = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/@media[^{]+\{([\s\S]*?\})\s*\}/g, "$1")
  .split("}")
  .map((block) => block.split("{")[0].trim())
  .filter(Boolean)
  .flatMap((selector) => selector.split(/,(?![^(]*\))/).map((part) => part.trim()));
check("homepage css modules: every selector starts with a local class (one documented #main-content exception)", () => {
  for (const path of ["components/home/hero.module.css", "components/home/programmes.module.css", "components/home/sessions.module.css", "components/calendar/calendar.module.css", "components/course/course.module.css", "components/training/training.module.css", "components/training/scaffolding.module.css", "components/premium/utility-spacing.module.css", "components/premium/footer.module.css"]) {
    for (const selector of selectorsOf(path)) {
      // hero.module.css matches the ID specificity of globals.css's phone heading rule for the hero title only.
      if (selector === ":global(#main-content) .copy .title" || selector === ":global(#main-content) .title") continue;
      assert.match(selector, /^\.[A-Za-z]/, `${path}: ${selector}`);
      assert.ok(!selector.includes(":global"), `${path}: ${selector}`);
    }
  }
});
check("public css never targets admin, certificate, verification, registration or print classes", () => {
  const files = ["components/premium/premium.module.css", "components/premium/header.module.css", "components/home/hero.module.css", "components/home/programmes.module.css", "components/home/sessions.module.css", "components/calendar/calendar.module.css", "components/course/course.module.css", "components/training/training.module.css", "components/training/scaffolding.module.css", "components/premium/utility-spacing.module.css", "components/premium/footer.module.css"];
  // Comments are removed first: they document the isolation and may name those surfaces; only CSS code is checked.
  for (const path of files) {
    const code = read(path).replace(/\/\*[\s\S]*?\*\//g, "");
    const hit = /teras-admin|verify-page|verification-route|registration-page|registration-status|feedback-page|attendance|certificate|@media print/i.exec(code);
    assert.ok(!hit, `${path}: ${hit?.[0]}`);
  }
});

// ---- protected surfaces are byte-for-byte unchanged (git sees through CRLF conversion) --------
const git = (args: string[]) => execFileSync("git", args, { cwd: rootPath, encoding: "utf8" });
const PROTECTED = ["app/globals.css", "app/layout.js", "app/admin", "components/admin", "app/verify", "app/registration", "app/api", "lib/supabase", "middleware.ts", "next.config.mjs"];
// S5B-1B Round 1 (owner-approved, local only): exactly these protected-path files may differ from HEAD, and
// only in the narrow ways asserted below. Anything else under a protected path still fails this contract.
const ROUND1_APPROVED = ["app/layout.js", "app/api/contact/route.js", "app/api/newsletter/route.js", "app/api/request-proposal/route.js"];
// Public-First release (K-4): the ToyyibPay R2/R4 payment and admin changes are NOT part of this release, so their
// former allowances are gone -- any change under a protected path other than Round 1 and the named Public-First
// fixes now fails this contract. Comparisons use the fixed CONTRACT_BASE (scripts/contract-base.mts), not HEAD.
const changedLines = (path: string) => git(["diff", "-U0", CONTRACT_BASE, "--", path]).split("\n").filter((line) => /^[+-](?![+-])/.test(line));
check("protected paths have no changes against the contract base except the S5B-1B Round 1 approved files", () => {
  // W4-a (owner-approved, W4-a-G1): app/globals.css may differ only by the named W4-a rules (scripts/w4a-approved.mts);
  // once they are undone the file must equal the contract base byte for byte.
  const w4aOnly = (path: string) => W4A_CHANGED.includes(path)
    && revertW4a(path, read(path)).replace(/\r\n/g, "\n") === git(["show", `${CONTRACT_BASE}:${path}`]).replace(/\r\n/g, "\n");
  const changed = git(["diff", "--name-only", CONTRACT_BASE, "--", ...PROTECTED]).trim().split("\n").filter(Boolean).filter((path) => !ROUND1_APPROVED.includes(path) && !PF_CHANGED.includes(path) && !w4aOnly(path));
  assert.deepEqual(changed, [], changed.join(", "));
});
check("Round 1: app/layout.js changes only the two JSON-LD email values", () => {
  // Public-First F-5 (canonical origin centralised) is reverted first; only the Round 1 lines may then differ from HEAD.
  const head = git(["show", `${CONTRACT_BASE}:app/layout.js`]).replace(/\r\n/g, "\n").split("\n");
  const now = revertPublicFirst("app/layout.js", read("app/layout.js").replace(/\r\n/g, "\n")).split("\n");
  const lines = [...now.filter((l) => !head.includes(l)).map((l) => `+${l}`), ...head.filter((l) => !now.includes(l)).map((l) => `-${l}`)];
  assert.ok(lines.every((line) => /^[+-]\s*email: "(training|admin)@terasuniversal\.com\.my",$/.test(line)), lines.join("\n"));
});
check("Round 1: API route changes never touch recipients, email sending, persistence RPCs or rate limiting", () => {
  for (const path of ROUND1_APPROVED.filter((p) => p.startsWith("app/api/"))) {
    const lines = changedLines(path);
    assert.ok(!lines.some((line) => /INTERNAL_RECIPIENT|emails\.send|contacts\.create|\.rpc\(|rate|limit|Map\(|getClientIp\(request\)\s*[,)]?\s*$/i.test(line) && !/console\.error/.test(line)), `${path}:\n${lines.join("\n")}`);
  }
});
check("protected paths have no new files (committed or untracked) since the contract base", () => {
  const added = changedSinceBase(PROTECTED).filter((line) => line.startsWith("?? ")).map((line) => line.slice(3)).filter((path) => !PF_ADDED.includes(path) && !W9G3_PROTECTED_ADDED.includes(path) /* W9-G3.3 exact paths */);
  assert.deepEqual(added, [], added.join(", "));
});
check("header css: no token redefinitions, @font-face, @import or url()", () => {
  assert.ok(!/@font-face|@import|url\(/.test(headerCss));
  assert.ok(!/(^|[\s;{])--[\w-]+\s*:/.test(headerCss));
});
check("fonts: public body face uses the existing self-hosted Inter file and its own variable", () => {
  const fonts = read("components/premium/fonts.js");
  assert.match(fonts, /next\/font\/local/);
  assert.match(fonts, /app\/fonts\/inter\/inter-v20-latin-wght-normal\.woff2/);
  assert.match(fonts, /variable: "--font-public-body"/);
  assert.ok(!/next\/font\/google/.test(fonts));
});
check("fonts: root and admin layouts are unchanged in their font setup", () => {
  assert.ok(!read("app/layout.js").includes("font-public-body"));
  assert.match(read("app/admin/layout.tsx"), /variable: "--font-inter"/);
});

console.log(failures ? `\n${failures} semakan GAGAL` : "\nSemua semakan LULUS");
process.exit(failures ? 1 : 0);
