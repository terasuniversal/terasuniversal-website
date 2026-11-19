import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homeContent } from "../content/en/home.js";
import { brand, companyProfile } from "../data/companyProfile.js";
import { faqItems } from "../data/faq.js";
import { publicContact } from "../data/publicContact.js";

// Contract for content/en/home.js and the homepage display email (Phase S1). Reads repository files only.
const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

// data/courseCatalog.js imports a TypeScript module without an extension, which plain Node cannot resolve, so the catalogue
// is read as text (same approach as scripts/check-phase3-course-mapping.mts): each entry's slug and its duration.
const catalogText = read("data/courseCatalog.js");
const courseCatalog = [...catalogText.matchAll(/slug: "([^"]+)"[\s\S]*?duration: "([^"]+)"/g)].map(([, slug, duration]) => ({ slug, duration }));
let failures = 0;
const check = (name: string, fn: () => void) => {
  try { fn(); console.log(`LULUS ${name}`); } catch (error) { failures += 1; console.log(`GAGAL ${name} -> ${(error as Error).message.split("\n")[0]}`); }
};

// ---- content mirrors verified sources ------------------------------------------
check("content: English locale", () => assert.equal(homeContent.locale, "en-MY"));
check("content: official tagline, same as brand.tagline", () => {
  assert.equal(homeContent.tagline, "Building Competence. Creating Opportunities.");
  assert.equal(homeContent.tagline, brand.tagline);
});
check("content: Working at Height is 2 Days and matches the catalogue", () => {
  const wah = homeContent.courses.items.find((item) => item.key === "working-at-height");
  assert.equal(wah?.duration, "2 Days");
  assert.equal(courseCatalog.find((course) => course.slug === "working-at-height")?.duration, "2 Days");
});
check("content: every course duration equals the catalogue for each listed slug", () => {
  for (const item of homeContent.courses.items) {
    assert.ok(item.catalogSlugs.length > 0, item.key);
    for (const slug of item.catalogSlugs) {
      const course = courseCatalog.find((entry) => entry.slug === slug);
      assert.ok(course, `missing catalogue slug ${slug}`);
      assert.equal(course.duration, item.duration, `${slug} duration`);
    }
  }
});
check("content: FAQ questions exist word for word in data/faq.js (answers stay single-sourced)", () => {
  const known = new Set(faqItems.map(([, question]) => question));
  for (const question of homeContent.faq.questions) assert.ok(known.has(question), question);
});
check("content: no international, accreditation or eligibility claims", () => {
  const text = JSON.stringify(homeContent);
  for (const pattern of [/international/i, /accredit/i, /world[- ]class/i, /\bISO\b/, /certified by/i, /recogni[sz]ed by/i, /guarantee/i, /eligib/i, /globally/i]) {
    assert.ok(!pattern.test(text), `found ${pattern}`);
  }
});
check("content: public-session labels present", () => {
  assert.equal(homeContent.sessions.title, "Next public sessions");
  assert.equal(homeContent.sessions.viewAll.label, "View All Public Sessions");
  assert.equal(homeContent.hero.sessionsLink.label, "See upcoming public sessions");
});
check("content: hero secondary CTA is the approved Request a Proposal action (R2 S1); corporate CTA unchanged", () => {
  assert.equal(homeContent.hero.secondaryCta.label, "Request a Proposal");
  assert.equal(homeContent.hero.secondaryCta.href, "/request-proposal");
  assert.equal(homeContent.hero.lead, "Professional industrial training, competency development and consultancy solutions.");
  assert.ok(homeContent.corporate.cta.href.startsWith("/request-proposal"));
});
check("content: no session data, fees, dates or venues are hard-coded", () => {
  const text = JSON.stringify(homeContent);
  assert.ok(!/RM\s?\d/.test(text), "fee amount");
  assert.ok(!/\b20\d\d-\d\d-\d\d\b/.test(text), "ISO date");
  assert.ok(!/\b\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/.test(text), "calendar date");
});

// ---- links point at routes and anchors that exist today -------------------------
const hrefs: string[] = [];
JSON.stringify(homeContent, (key, value) => { if (key === "href") hrefs.push(value); return value; });
const pageIn = (dir: string) => ["page.js", "page.tsx", "page.jsx", "page.ts"].some((file) => existsSync(new URL(`${dir}/${file}`, root)));
// A static page, or /training/<slug> served by app/training/[slug] for a slug that is in the catalogue.
const routeExists = (path: string) => {
  if (pageIn(`app${path === "/" ? "" : path}`)) return true;
  const course = /^\/training\/([^/]+)$/.exec(path);
  return Boolean(course && pageIn("app/training/[slug]") && courseCatalog.some((entry) => entry.slug === course[1]));
};
const homepageSource = ["app/page.js", ...["CoreProgrammes", "UpcomingDates", "HomeFaq", "HomeContact", "Recognition", "DeliveryOptions", "HomeHero"].map((name) => `components/home/${name}.js`)].map(read).join("\n");
check("links: every route exists and every #anchor is on the current homepage", () => {
  assert.ok(hrefs.length >= 10);
  for (const href of hrefs) {
    if (href.startsWith("#")) assert.ok(homepageSource.includes(`id="${href.slice(1)}"`), `anchor ${href}`);
    else assert.ok(routeExists(href.split(/[?#]/)[0]), `route ${href}`);
  }
});

// ---- display email: homepage only, delivery unchanged ---------------------------
check("email: the shared display address is admin@terasuniversal.com.my", () => assert.equal(companyProfile.contact.email, "admin@terasuniversal.com.my"));
check("email: companyProfile takes the address from data/publicContact.js (one source)", () => {
  assert.equal(companyProfile.contact.email, publicContact.email);
  assert.match(read("data/companyProfile.js"), /email: publicContact\.email/);
});
// S2B moved the homepage contact strip into the shared header and was approved to align the shared header, footer and
// mobile contact panel (owner brief S2B §4A and §4D). These checks follow that scope: every display point it covers reads
// the one shared address, and everything outside it keeps its current value.
check("email: header, footer, mobile contact panel and HomeContact read the shared address (no training@ literal)", () => {
  for (const path of ["components/premium/PremiumHeader.js", "components/Footer.js", "components/MobileNav.js", "components/home/HomeContact.js"]) {
    const source = read(path);
    // Server components read companyProfile; the MobileNav client component reads the small publicContact module.
    assert.ok(/companyProfile|publicContact/.test(source), `${path} reads the shared contact source`);
    assert.ok(!source.includes("training@terasuniversal.com.my"), path);
  }
});
check("email: the homepage page file carries no email literal of its own", () => {
  assert.ok(!/@terasuniversal\.com\.my/.test(read("app/page.js")));
});
check("email: form recipients are unchanged (training@)", () => {
  assert.match(read("app/api/contact/route.js"), /INTERNAL_RECIPIENT = "training@terasuniversal\.com\.my"/);
  assert.match(read("app/api/request-proposal/route.js"), /INTERNAL_RECIPIENT = "training@terasuniversal\.com\.my"/);
});
// S5B-1B Round 1 (owner-approved): public display copy and JSON-LD now use admin@. Only the two backend
// recipients above may still name training@; the certificate page (app/verify) is protected and out of scope.
check("email: public display copy and JSON-LD use admin@, never training@ (S5B-1B Round 1)", () => {
  for (const path of ["data/faq.js", "app/layout.js", "app/contact/page.js", "components/ContactEnquiryForm.js", "components/ContactForm.js", "components/FaqAccordion.js", "app/request-proposal/page.js", "app/request-proposal/success/page.js"]) {
    const source = read(path);
    assert.ok(!source.includes("training@terasuniversal.com.my"), `${path} still carries training@`);
    for (const [, address] of source.matchAll(/mailto:([^"'`\s)]+)/g)) assert.equal(address, "admin@terasuniversal.com.my", `${path}: mailto ${address}`);
  }
  assert.equal((read("app/layout.js").match(/email: "admin@terasuniversal\.com\.my"/g) || []).length, 2, "both JSON-LD blocks use admin@");
});

console.log(failures ? `\n${failures} semakan GAGAL` : "\nSemua semakan LULUS");
process.exit(failures ? 1 : 0);
