import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { revertPublicFirst, PF_CHANGED, PF_ADDED, PF_WITHHELD } from "./public-first-approved.mts";
import { CONTRACT_BASE, changedSinceBase } from "./contract-base.mts";
import { revertS2_0 } from "./r2-s2-0-approved.mts";

// Phase S4D-2A (owner-approved pilot): /about, /services and /corporate-training use the shared PremiumHeader instead
// of their own legacy header. Phase S4D-2B (owner-approved rollout) adds the eight remaining eligible content routes.
// Phase S4D-2C (owner-approved) adds the lead and contact pages: /contact, /request-proposal, its success page and
// /insights, header only; their forms, endpoints, redirects and newsletter component are proven untouched.
// Proves the header is reused (not copied), sits once before <main>, and that nothing else in those pages changed
// against HEAD: content, section order, links, images, metadata and Footer are byte-identical once the header swap is
// taken out. Also proves the routes left out of the rollout (forms, lead capture, transactional, verification, errors)
// are untouched and still carry their legacy header.
const root = new URL("../", import.meta.url);
const rootPath = fileURLToPath(root);
const read = (path: string) => readFileSync(new URL(path, root), "utf8").replace(/\r\n/g, "\n");
const atHead = (path: string) => execFileSync("git", ["show", `${CONTRACT_BASE}:${path}`], { cwd: rootPath, encoding: "utf8" }).replace(/\r\n/g, "\n");
let failures = 0;
const check = (name: string, fn: () => void) => {
  try { fn(); console.log(`LULUS ${name}`); } catch (error) { failures += 1; console.log(`GAGAL ${name} -> ${(error as Error).message.split("\n")[0]}`); }
};

const PILOT = ["app/about/page.js", "app/services/page.js", "app/corporate-training/page.js"];
const ROLLOUT = ["app/services/scaffolding/page.js", "app/industries/page.js", "app/industries/[slug]/page.js", "app/resources/page.js", "app/faq/page.js", "app/gallery/page.js", "app/stories/page.js", "app/search/page.js"];
const LEAD = ["app/contact/page.js", "app/request-proposal/page.js", "app/request-proposal/success/page.js", "app/insights/page.js"];
// S5C (owner-approved, local): five figures swap an abstract panel or the poster of unverified provenance for an
// authentic TERAS photograph with a caption. Each exact new figure is mapped back to its HEAD markup, so the rest of
// every page body is still proven identical; scripts/s5c-visual-contract.mts covers the new figures themselves.
const S5C_CAPTION = "<figcaption className={bridge.photoNote}>Photograph: TERAS UNIVERSAL training yard, Kedah, 2024.</figcaption>";
const S5C_FIGURES: [string, string][] = [
  ["<figure className=\"about-story-media\"><Image src=\"/images/authentic/teras-yard-trainees-landscape.webp\" alt=\"Aerial photograph of the TERAS UNIVERSAL practical training yard in Kedah: trainees in hard hats and harnesses working on tube-and-coupler scaffolds during a practical session, October 2024\" width={1500} height={1000} sizes=\"(max-width: 920px) 100vw, 50vw\" />", "<figure className=\"about-story-media\"><Image src=\"/images/v2/panel-c.svg\" alt=\"\" unoptimized width={1200} height={800} sizes=\"(max-width: 920px) 100vw, 50vw\" />"],
  ["<figure className=\"contact-page-hero-media\"><Image src=\"/images/authentic/teras-yard-overhead-landscape.webp\" alt=\"Overhead aerial photograph of the TERAS UNIVERSAL practical training yard in Kedah, showing tube-and-coupler scaffold training structures and trainees in hard hats, October 2024\" width={1500} height={1000} priority sizes=\"(max-width: 920px) 100vw, 52vw\" />", "<figure className=\"contact-page-hero-media\"><Image src=\"/images/v2/panel-a.svg\" alt=\"\" unoptimized width={1200} height={800} priority sizes=\"(max-width: 920px) 100vw, 52vw\" />"],
  ["<figure className=\"service-detail-media scaffolding-teaser-media\"><Image src=\"/images/authentic/teras-yard-trainees-portrait.webp\" alt=\"Aerial photograph of the TERAS UNIVERSAL practical training yard in Kedah: trainees in hard hats and harnesses working on tube-and-coupler scaffolds during a practical session, October 2024\" width={900} height={1350} sizes=\"(max-width: 920px) 260px, 340px\" />", "<figure className=\"service-detail-media scaffolding-teaser-media\"><Image src=\"/images/scaffolding-rental-poster-en.webp\" alt=\"TERAS UNIVERSAL Scaffolding Rental and Installation Services\" width={853} height={1280} sizes=\"(max-width: 920px) 260px, 340px\" />"],
  ["<figure className=\"scaffolding-hero-media\"><Image src=\"/images/authentic/teras-yard-trainees-portrait.webp\" alt=\"Aerial photograph of the TERAS UNIVERSAL practical training yard in Kedah: trainees in hard hats and harnesses working on tube-and-coupler scaffolds during a practical session, October 2024\" width={900} height={1350} priority sizes=\"(max-width: 920px) 260px, 340px\" />", "<figure className=\"scaffolding-hero-media\"><Image src=\"/images/scaffolding-rental-poster-en.webp\" alt=\"TERAS UNIVERSAL Scaffolding Rental and Installation Services\" width={853} height={1280} priority sizes=\"(max-width: 920px) 260px, 340px\" />"],
  ["<figure className=\"scaffolding-poster-media\"><Image src=\"/images/authentic/teras-yard-overhead-portrait.webp\" alt=\"Overhead aerial photograph of the TERAS UNIVERSAL practical training yard in Kedah, showing tube-and-coupler scaffold training structures and trainees in hard hats, October 2024\" width={900} height={1350} sizes=\"(max-width: 920px) 260px, 340px\" />", "<figure className=\"scaffolding-poster-media\"><Image src=\"/images/scaffolding-rental-poster-en.webp\" alt=\"TERAS UNIVERSAL Scaffolding Rental and Installation Services\" width={853} height={1280} sizes=\"(max-width: 920px) 260px, 340px\" />"],
];
const revertS5C = (text: string) => S5C_FIGURES.reduce((out, [now, head]) => out.replace(now + S5C_CAPTION, head), text);
// S6-REVERSALS-BEGIN (generated) — S6 (owner-approved, local): exact S6 edits to pinned files, mapped back to their
// pre-S6 text so the rest of each file is still proven identical; scripts/s6-content-contract.mts covers the S6
// additions themselves. Each pair must match exactly once or the comparison fails.
const S6_REVERSALS: Record<string, [string, string][]> = {"app/insights/page.js": [["export const metadata = { title: \"News & Articles\", description: \"Practical articles on industrial safety, scaffolding, competency development and workforce training from TERAS UNIVERSAL.\", alternates: { canonical: \"/insights\" }, ...socialMetadata({ title: \"News & Articles | TERAS UNIVERSAL\", description: \"Practical articles on industrial safety, scaffolding, competency development and workforce training from TERAS UNIVERSAL.\", path: \"/insights\" }) };", "export const metadata = { title: \"News & Insights\", description: \"Safety, construction, Oil & Gas, training and compliance insights from TERAS UNIVERSAL.\", alternates: { canonical: \"/insights\" }, ...socialMetadata({ title: \"News & Insights | TERAS UNIVERSAL\", description: \"Safety, construction, Oil & Gas, training and compliance insights from TERAS UNIVERSAL.\", path: \"/insights\" }) };"], ["<span className=\"eyebrow\">News &amp; Articles</span>", "<span className=\"eyebrow\">Knowledge Centre</span>"], ["import InsightsCentre from \"../../components/InsightsCentre\";\nimport EbookPromo from \"../../components/ebook/EbookPromo\";\n", "import InsightsCentre from \"../../components/InsightsCentre\";\n"], ["<InsightsCentre /><EbookPromo />", "<InsightsCentre />"]], "components/InsightsCentre.js": [["<span className=\"sr-only\">Search articles</span>", "<span className=\"sr-only\">Search insights</span>"], ["placeholder=\"Search articles...\"", "placeholder=\"Search safety insights...\""], ["aria-label=\"Filter articles by topic\"", "aria-label=\"Filter insights\""], ["<strong>{visible.length}</strong> article{visible.length === 1 ? \"\" : \"s\"}", "<strong>{visible.length}</strong> insight{visible.length === 1 ? \"\" : \"s\"} available"], ["<div><span>{Array.isArray(item.body) ? item.readTime : \"Full article in preparation\"}</span><a href={`/insights/${item.slug}`}>{Array.isArray(item.body) ? \"Read article\" : \"Read summary\"} <span aria-hidden=\"true\">&rarr;</span><span className=\"sr-only\">: {item.title}</span></a></div>", "<div><span>{item.readTime}</span><a href={`/insights/${item.slug}`}>Read insight <span aria-hidden=\"true\">&rarr;</span></a></div>"], ["No articles match your search.", "No insights match your search."]]};
const revertS6 = (path: string, text: string) => (S6_REVERSALS[path] ?? []).reduce((out, [now, before]) => { assert.equal(out.split(now).length, 2, `${path}: S6 edit not found exactly once`); return out.replace(now, before); }, text);
// S6-REVERSALS-END
const squash = (text: string) => text.replace(/\s+/g, " ").trim();
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

for (const path of [...PILOT, ...ROLLOUT, ...LEAD]) {
  // Public-First fixes reverted (scripts/public-first-approved.mts). R2 S2-0 (owner-approved, 19 Nov 2026): the single
  // named edit on app/resources/page.js (Company Profile PDF link removed) is undone first; it must be present exactly once.
  const page = revertPublicFirst(path, revertS2_0(path, read(path)));
  const up = "../".repeat(path.split("/").length - 1);
  check(`${path}: imports the shared PremiumHeader and renders it exactly once`, () => {
    assert.match(page, new RegExp(`^import PremiumHeader from "${escape(up)}components/premium/PremiumHeader";$`, "m"));
    assert.equal((page.match(/<PremiumHeader \/>/g) ?? []).length, 1);
  });
  check(`${path}: the header comes before <main>, not inside it`, () => {
    // The header is the sibling directly before the page's <main> (a page may also have an early not-found <main>).
    assert.match(page, /<PremiumHeader \/>\s*<main /);
  });
  check(`${path}: no legacy header, legacy logo or direct MegaNav / MobileNav use is left`, () => {
    assert.doesNotMatch(page, /site-header|nav-wrap|teras-universal-logo\.png|<MegaNav|<MobileNav|components\/MegaNav|components\/MobileNav/);
  });
  check(`${path}: apart from the header swap the file is identical to HEAD`, () => {
    const original = atHead(path);
    let before = original
      .replace(new RegExp(`^import MobileNav from "${escape(up)}components/MobileNav";\\n`, "m"), "")
      .replace(new RegExp(`^import MegaNav from "${escape(up)}components/MegaNav";\\n`, "m"), "")
      .replace(/<header className="site-header">[\s\S]*?<\/header>/, "");
    // next/image may go only where the legacy logo was its last use (no dead import left behind).
    if (!/^import Image from "next\/image";$/m.test(page)) {
      assert.doesNotMatch(before, /<Image/, "Image import removed while Image is still used");
      before = before.replace(/^import Image from "next\/image";\n/m, "");
    }
    const after = revertS5C(revertS6(path, page))
      // S5B-1B Round 3 (owner-approved): the V2 bridge class + Inter variable on <main>, social metadata, the hard
      // 404 for unknown industry slugs and the AI-image caption on /about are reverted here, so the page body is still
      // proven identical to HEAD; scripts/s5b1b-round3-contract.mts covers those additions themselves.
      .replace(new RegExp(`^import \\{ publicBody \\} from "${escape(up)}components/premium/fonts";\\n`, "m"), "")
      .replace(new RegExp(`^import bridge from "${escape(up)}components/premium/legacy-bridge\\.module\\.css";\\n`, "m"), "")
      .replace(new RegExp(`^import \\{ socialMetadata \\} from "${escape(up)}lib/social-metadata";\\n`, "m"), "")
      .replace(" ${bridge.page} ${publicBody.variable}`}>", "`}>")
      .replace(/<main className=\{`([^`$]+)`\}>/, '<main className="$1">')
      .replace(/^\/\/ S5B-1B Round 3: every industry page[^\n]*\n\/\/ the router[^\n]*\nexport const dynamicParams = false;\n/m, "")
      .replace('alt="AI-generated illustration: an instructor briefing', 'alt="An instructor briefing')
      .replace("<figcaption className={bridge.aiNote}>AI-generated illustration for visual representation.</figcaption>", "")
      .replace(new RegExp(`^import PremiumHeader from "${escape(up)}components/premium/PremiumHeader";\\n`, "m"), "")
      // Utility pages only: the scoped class that restores the top padding the legacy header used to trigger.
      .replace(/^import spacing from "\.\.\/\.\.\/components\/premium\/utility-spacing\.module\.css";\n/m, "")
      .replace('<main className={`utility-page ${spacing.afterHeader}`}>', '<main className="utility-page">')
      .replace(/^\/\/ Phase S4D-2[ABC]( pilot)?: the shared Premium header.*\n\/\/ pages, sits before <main>.*\n/m, "")
      // Phase S4D-2D: the Premium footer replaces the shared footer in place (scripts/premium-footer-contract.mts).
      .replace(new RegExp(`^import PremiumFooter from "${escape(up)}components/premium/PremiumFooter";$`, "m"), `import Footer from "${up}components/Footer";`)
      .replace("<PremiumFooter />", "<Footer />")
      // S5B-1B Round 2 (owner-approved): the footer moved from the end of <main> to just after it (landmark fix).
      .replace(/<\/main>(\s*)<Footer \/>(\s*)<\/>/, "<Footer />$1</main>$2</>")
      // S5B-1B Round 2: the success page no longer promises an unverified confirmation email.
      .replace("Your proposal request has been received by our team. We will review", "Your proposal request has been sent to our team. A confirmation email is on its way to you. We will review")
      .replace(/<>\s*<PremiumHeader \/>\s*/, "")
      .replace(/<\/main>\s*<\/>/, "</main>")
      // S5B-1B Round 1 (owner-approved): public display email admin@ (was training@) ...
      .replaceAll("admin@terasuniversal.com.my", "training@terasuniversal.com.my")
      // ... and, on the proposal success page only, the page-local legacy footer inside <main> replaced by the
      // Premium footer after <main> (scripts/premium-footer-contract.mts proves the new footer).
      // (The S4D-2C rule above already removed the first two comment lines; this drops the Round 1 continuation.)
      .replace(/^\/\/ with a hard-coded year and the old training@ address\) is replaced by the Premium footer after <main>\.\n/m, "")
      .replace(/<\/section><Footer \/>\s*<\/main>/, '</section><footer><div className="container footer-bottom"><span>&copy; 2026 TERAS UNIVERSAL SDN. BHD. All rights reserved.</span><span><a href="mailto:training@terasuniversal.com.my">training@terasuniversal.com.my</a></span></div></footer></main>')
      .replace(/<\/footer><\/main>\s*<\/>/, "</footer></main>")
      .replace(new RegExp(`^import Footer from "${escape(up)}components/Footer";\\n(?![\\s\\S]*<Footer)`, "m"), "");
    // Round 3: metadata (title, description, canonical, Open Graph) is compared by scripts/s5b1b-round3-contract.mts,
    // not here; everything else in the file must still match.
    const stripMeta = (text: string) => text.replace(/^export const metadata = \{\n[\s\S]*?^\};\n/m, "").replace(/^export (const metadata|async function generateMetadata)[^\n]*\n/m, "");
    assert.equal(squash(stripMeta(after)), squash(stripMeta(before)));
  });
}

check("route layouts (metadata, canonical) are unchanged against HEAD", () => {
  for (const path of ["app/about/layout.js", "app/services/layout.js", "app/services/scaffolding/layout.js", "app/gallery/layout.js", "app/contact/layout.js"]) assert.equal(revertPublicFirst(path, read(path)), atHead(path), path); // F-5 canonical origin reverted
  // S5B-1B Round 3: request-proposal/layout.js only gains the social-metadata import and spread (title, description
  // and canonical unchanged); the default export is untouched.
  const proposalLayout = read("app/request-proposal/layout.js")
    .replace(/^import \{ socialMetadata \} from "\.\.\/\.\.\/lib\/social-metadata";\n/m, "")
    .replace(/, \.\.\.socialMetadata\(\{[^\n]*?path: "\/request-proposal" \}\) \};/, " };");
  assert.equal(proposalLayout, atHead("app/request-proposal/layout.js"));
});
check("PremiumHeader is used by the approved Premium pages, the pilot pages, the S4D-2B routes and the S4D-2C lead pages only", () => {
  const out = execFileSync("git", ["grep", "-l", "--untracked", "components/premium/PremiumHeader", "--", "app"], { cwd: rootPath, encoding: "utf8" });
  assert.deepEqual(out.trim().split("\n").sort(), ["app/calendar/page.js", "app/page.js", "app/training/[slug]/page.js", "app/training/page.js", "app/training/scaffolding-competency/page.js", "app/insights/[slug]/page.js",
    // S5B-1B Round 2: the 404 page and the local-only draft legal pages.
    "app/not-found.js", "app/privacy/[[...lang]]/page.js", "app/terms/[[...part]]/page.js",
    // S6: the local-preview eBook landing page (gated by TERAS_EBOOK_PREVIEW).
    "app/ebook/[[...ebook]]/page.js", ...PILOT, ...ROLLOUT, ...LEAD].sort());
});
check("lead pages still render their own form or confirmation, with the form components, endpoints and redirect untouched", () => {
  assert.match(read("app/contact/page.js"), /<ContactEnquiryForm \/>/);
  assert.match(read("app/request-proposal/page.js"), /<ProposalWizard \/>/);
  assert.match(read("app/insights/page.js"), /<NewsletterSignup \/>/);
  assert.match(read("app/request-proposal/success/page.js"), /Thank You for Sharing Your Requirements/);
  // S5B-1B Round 1 approved edits (admin@ display, honest newsletter message, neutral errors, no IP in logs) are proven by
  // scripts/home-content-contract.mts and scripts/public-design-foundation-contract.mts; the rest stay identical to HEAD.
  // Round 2 adds the ProposalWizard privacy note (scripts/s5b1b-round2-contract.mts proves the payload is unchanged).
  const ROUND1_APPROVED = ["components/ContactEnquiryForm.js", "components/ProposalWizard.js", "components/NewsletterSignup.js", "app/api/contact/route.js", "app/api/request-proposal/route.js", "app/api/newsletter/route.js"];
  for (const path of ["components/ContactEnquiryForm.js", "components/ProposalWizard.js", "components/NewsletterSignup.js", "components/InsightsCentre.js", "components/LeadGenCta.js", "app/api/contact/route.js", "app/api/request-proposal/route.js", "app/api/newsletter/route.js"].filter((path) => !ROUND1_APPROVED.includes(path))) assert.equal(revertS6(path, read(path)), atHead(path), path);
  assert.match(read("components/ContactEnquiryForm.js"), /fetch\("\/api\/contact"/);
  assert.match(read("components/ProposalWizard.js"), /fetch\("\/api\/request-proposal"[\s\S]*router\.push\("\/request-proposal\/success"\)/);
  assert.match(read("components/NewsletterSignup.js"), /fetch\("\/api\/newsletter"/);
});
check("the utility-page spacing fix is used by /faq, /search, /stories and /insights only, and only restores the reduced top padding", () => {
  const out = execFileSync("git", ["grep", "-l", "--untracked", "utility-spacing.module.css", "--", "app", "components"], { cwd: rootPath, encoding: "utf8" });
  assert.deepEqual(out.trim().split("\n").sort(), ["app/faq/page.js", "app/insights/page.js", "app/search/page.js", "app/stories/page.js"]);
  const css = read("components/premium/utility-spacing.module.css").replace(/\/\*[\s\S]*?\*\//g, "").trim();
  assert.equal(css, ".afterHeader > div:first-child { padding-top: clamp(40px, 6vw, 64px); }");
  // Same value as the globals.css rule it replaces for these pages.
  assert.match(read("app/globals.css"), /\.site-header \+ \.container\.utility-container \{\n  padding-top: clamp\(40px, 6vw, 64px\);/);
});
// Still left out on purpose: registration, verification, feedback and payment routes. They must be byte-identical
// to HEAD. S5B-1B Round 1 moved /insights/[slug] (Premium header + footer) and the 404 page (Premium footer only;
// its legacy header stays) out of this list; scripts/premium-footer-contract.mts covers them.
const EXCLUDED = ["app/loading.js", "app/registration/[scheduleId]/page.tsx", "app/registration/status/page.tsx", "app/verify/page.js", "app/verify/page.tsx", "app/verify/[token]/page.tsx", "app/feedback/[token]/page.tsx", "app/feedback/s/[publicToken]/page.tsx", "app/payments/toyyibpay/return/page.tsx", "app/payments/toyyibpay/registration-return/page.tsx", "app/program-tajaan-ypm/route.js"];
// ToyyibPay R2 (owner-approved, PAY-02): the public payment return page became display-only. Its behaviour is proven
// by scripts/toyyibpay-r2-payment.test.mts (scenarios 20, 21 and S-1); every other excluded route stays byte-identical.
const R2_APPROVED_EXCLUDED = ["app/payments/toyyibpay/return/page.tsx"];
check("excluded, transactional and protected routes are unchanged against HEAD", () => {
  // Public-First F-1 (registration kill switch) and F-4 (/verify contrast) are reverted before the comparison.
  for (const path of EXCLUDED.filter((entry) => !R2_APPROVED_EXCLUDED.includes(entry))) assert.equal(revertPublicFirst(path, read(path)), atHead(path), path);
});
check("the legacy header now remains only on the excluded routes", () => {
  const out = execFileSync("git", ["grep", "-l", "--untracked", 'className="site-header"', "--", "app"], { cwd: rootPath, encoding: "utf8" });
  // S5B-1B Round 2: the 404 page now uses the Premium header; only the protected routes keep the legacy one.
  assert.deepEqual(out.trim().split("\n").sort(), ["app/registration/[scheduleId]/page.tsx", "app/verify/page.js"]);
});
check("the shared header, menus and Footer are not modified by the pilot", () => {
  // Git blob hashes taken before the pilot started (the S4D-2A preflight); a later approved change updates them here.
  // Public-First F-1 (header action wording) is reverted before hashing (scripts/public-first-approved.mts).
  // revertPublicFirst also undoes the W2-A address edits (scripts/w2a-address-approved.mts, e.g. components/Footer.js).
  const sha = (path: string) => PF_CHANGED.includes(path) || path === "components/Footer.js"
    ? execFileSync("git", ["hash-object", "--stdin", `--path=${path}`], { cwd: rootPath, encoding: "utf8", input: revertPublicFirst(path, readFileSync(new URL(path, root), "utf8")) }).trim()
    : execFileSync("git", ["hash-object", path], { cwd: rootPath, encoding: "utf8" }).trim();
  const expected: Record<string, string> = {
    "components/Footer.js": "7b63674a24674cfec55cba90e02645658e35ee5d",
    "components/premium/PremiumHeader.js": "193663ff6d4da660fb31ed863f7a3f715e1c855f",
    "components/premium/header.module.css": "ccc5efc25311bdb2cfa340cc32226f311cbabd2d",
    // S6 (owner-approved): "News & Insights" renamed "News & Articles" in MegaNav; MobileNav gains that link.
    "components/MegaNav.js": "d336b036b5635cf57b6707c98bfd24559f759d88",
    "components/MobileNav.js": "c8f1f2c717989bbb7a21cf8e78cf777bb5c8a6c7",
  };
  for (const [path, hash] of Object.entries(expected)) assert.equal(sha(path), hash, path);
});

console.log(failures ? `\n${failures} semakan GAGAL` : "\nSemua semakan LULUS");
process.exit(failures ? 1 : 0);
