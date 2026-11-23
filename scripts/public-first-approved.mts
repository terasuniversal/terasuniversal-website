/**
 * Public-First launch fixes (owner-approved, local only): the exact, named edits those fixes made to files that earlier
 * phase contracts pin to HEAD or to a fixed hash. revertPublicFirst(path, text) undoes ONLY these edits, so an earlier
 * contract keeps proving everything else in the file is exactly what it approved. scripts/public-first-launch-contract.mts
 * proves that reverting every listed file reproduces its pre-Public-First bytes (the R4 Wave 1 manifest hashes).
 *
 *  F-1 registration kill switch, F-2 drone photographs withheld (Option B: approved abstract panels), F-3 unverified
 *  poster moved out of public/, F-4 /verify secondary-text contrast, F-5 canonical origin centralised (default apex,
 *  no behaviour change), newsletter collection gated off.
 */
import { revertW2aAddress } from "./w2a-address-approved.mts";
import { revertW4a } from "./w4a-approved.mts";
import { revertW3 } from "./w3-approved.mts";
import { revertW7 } from "./w7-approved.mts";
import { revertW6seo } from "./w6seo-approved.mts";

const HOST = "https://terasuniversal.com.my";

// Approved abstract panels that replaced a drone photograph (F-2), mapped back to the drone figure they replaced.
const CAPTION = "<figcaption className={bridge.photoNote}>Photograph: TERAS UNIVERSAL training yard, Kedah, 2024.</figcaption>";
const TRAINEES_ALT = "Aerial photograph of the TERAS UNIVERSAL practical training yard in Kedah: trainees in hard hats and harnesses working on tube-and-coupler scaffolds during a practical session, October 2024";
const OVERHEAD_ALT = "Overhead aerial photograph of the TERAS UNIVERSAL practical training yard in Kedah, showing tube-and-coupler scaffold training structures and trainees in hard hats, October 2024";
const PANELS: Record<string, [string, string][]> = {
  "app/about/page.js": [['<Image src="/images/v2/panel-c.svg" alt="" unoptimized width={1200} height={800} sizes="(max-width: 920px) 100vw, 50vw" />', `<Image src="/images/authentic/teras-yard-trainees-landscape.webp" alt="${TRAINEES_ALT}" width={1500} height={1000} sizes="(max-width: 920px) 100vw, 50vw" />${CAPTION}`]],
  "app/contact/page.js": [['<Image src="/images/v2/panel-a.svg" alt="" unoptimized width={1200} height={800} priority sizes="(max-width: 920px) 100vw, 52vw" /></figure>', `<Image src="/images/authentic/teras-yard-overhead-landscape.webp" alt="${OVERHEAD_ALT}" width={1500} height={1000} priority sizes="(max-width: 920px) 100vw, 52vw" />${CAPTION}</figure>`]],
  "app/services/page.js": [['<Image src="/images/v2/panel-b.svg" alt="" unoptimized width={1200} height={800} sizes="(max-width: 920px) 260px, 340px" />', `<Image src="/images/authentic/teras-yard-trainees-portrait.webp" alt="${TRAINEES_ALT}" width={900} height={1350} sizes="(max-width: 920px) 260px, 340px" />${CAPTION}`]],
  "app/services/scaffolding/page.js": [
    ['<Image src="/images/v2/panel-b.svg" alt="" unoptimized width={1200} height={800} priority sizes="(max-width: 920px) 260px, 340px" />', `<Image src="/images/authentic/teras-yard-trainees-portrait.webp" alt="${TRAINEES_ALT}" width={900} height={1350} priority sizes="(max-width: 920px) 260px, 340px" />${CAPTION}`],
    ['<Image src="/images/v2/panel-c.svg" alt="" unoptimized width={1200} height={800} sizes="(max-width: 920px) 260px, 340px" />', `<Image src="/images/authentic/teras-yard-overhead-portrait.webp" alt="${OVERHEAD_ALT}" width={900} height={1350} sizes="(max-width: 920px) 260px, 340px" />${CAPTION}`],
  ],
};

// Line-based edits, written with \n and adapted to the file's own line endings.
const EDITS: Record<string, [string, string][]> = {
  "lib/public-content.ts": [
    ['import { createSupabaseServerClient } from "./supabase/server";\nimport { publicRegistrationEnabled } from "./public-registration-gate";\n', 'import { createSupabaseServerClient } from "./supabase/server";\n'],
    ["      // F-1: the server kill switch can only withhold registration, never grant it.\n      registration_available: publicRegistrationEnabled() && row.registration_available === true,", "      registration_available: row.registration_available === true,"],
    ["  registration_available: publicRegistrationEnabled() && row.registration_available === true,\n});", "  registration_available: row.registration_available === true,\n});"],
  ],
  "app/api/registration/route.ts": [
    ['import { publicRegistrationEnabled, REGISTRATION_DISABLED_MESSAGE } from "../../../lib/public-registration-gate";\n', ""],
    ["  // F-1: fail closed before any database call when public registration is switched off.\n  if (!publicRegistrationEnabled()) return NextResponse.json({ error: REGISTRATION_DISABLED_MESSAGE }, { status: 503 });\n", ""],
  ],
  "app/api/registration/payment/route.ts": [
    ['import { publicRegistrationEnabled, REGISTRATION_DISABLED_MESSAGE } from "../../../../lib/public-registration-gate";\n', ""],
    ["  // F-1: no new payment attempt and no ToyyibPay bill while public registration is switched off. Checked before the\n  // database and before ToyyibPay; callbacks for payments started earlier are separate routes and are not affected.\n  if (!publicRegistrationEnabled()) return NextResponse.json({ error: REGISTRATION_DISABLED_MESSAGE }, { status: 503 });\n", ""],
  ],
  "app/registration/[scheduleId]/page.tsx": [
    ['import { publicRegistrationEnabled } from "../../../lib/public-registration-gate";\n', ""],
    ["  // F-1: a 404 (not a page that fails at submission) while public registration is switched off; no schedule lookup.\n  if (!publicRegistrationEnabled()) notFound();\n", ""],
  ],
  "app/verify/page.tsx": [['<p style={{ color: "#667085", fontSize: 12.5, textAlign: "center", margin: "6px 0 0" }}>', '<p style={{ color: "#98a2b3", fontSize: 12.5, textAlign: "center", margin: "6px 0 0" }}>']],
  "app/verify/VerificationResult.tsx": [['<p style={{ textAlign: "center", color: "#667085", fontSize: 12, marginTop: 22 }}>', '<p style={{ textAlign: "center", color: "#98a2b3", fontSize: 12, marginTop: 22 }}>']],
  "app/api/newsletter/route.js": [
    ['import { newsletterEnabled } from "../../../lib/newsletter-gate";\n', ""],
    ["  // Public-First launch: newsletter collection is off unless TERAS_NEWSLETTER=enabled (lib/newsletter-gate.js).\n  if (!newsletterEnabled()) return responseError(\"Newsletter sign-up is not available at the moment.\", 503);\n", ""],
  ],
  "components/home/HomeContact.js": [
    ['import { newsletterEnabled } from "../../lib/newsletter-gate";\n', ""],
    ["      {/* Public-First launch: hidden until TERAS_NEWSLETTER=enabled (lib/newsletter-gate.js). */}\n      {newsletterEnabled() && (\n        <div id=\"newsletter\" className={styles.news}>\n          <h3 id=\"newsletter-title\" className={styles.h3}>Training Updates &amp; Industry Insights</h3>\n          <div className={styles.newsSlot}>\n            <NewsletterSignup />\n          </div>\n        </div>\n      )}\n",
      "      <div id=\"newsletter\" className={styles.news}>\n        <h3 id=\"newsletter-title\" className={styles.h3}>Training Updates &amp; Industry Insights</h3>\n        <div className={styles.newsSlot}>\n          <NewsletterSignup />\n        </div>\n      </div>\n"],
  ],
  // F-6 (release candidate): the sitemap lists the Privacy Notice only once lib/privacy-publication.js publishes it.
  "app/sitemap.js": [
    ['import { privacyPublished } from "../lib/privacy-publication";\n', ""],
    ["    // F-6: listed only once the Privacy Notice is published (lib/privacy-publication.js); Terms is never listed here.\n    ...(privacyPublished ? [`${siteUrl}/privacy`, `${siteUrl}/privacy/ms`].map((url) => ({ url, changeFrequency: \"yearly\", priority: 0.3 })) : []),\n", ""],
  ],
  // F-1 wording: the header action and the calendar intro never invite online registration while it is switched off.
  "content/en/home.js": [
    ['    // Public-First F-1: shown instead while public online registration is switched off (lib/public-registration-gate.ts).\n    registerCtaClosed: { label: "View Upcoming Training", shortLabel: "Sessions", href: "#upcoming-training" },\n', ""],
  ],
  "components/premium/PremiumHeader.js": [
    ['import { publicRegistrationEnabled } from "../../lib/public-registration-gate";\n', ""],
    ["  // Public-First F-1: never invite \"Register\" while public online registration is switched off; same target either way.\n  const registerCta = publicRegistrationEnabled() ? homeContent.header.registerCta : homeContent.header.registerCtaClosed;", "  const { registerCta } = homeContent.header;"],
  ],
  "content/en/calendar.js": [
    ['    // Public-First F-1: shown instead while public online registration is switched off (lib/public-registration-gate.ts).\n    leadClosed: "Browse public sessions arranged through the TERAS training schedule and enquire with TERAS about the next suitable date.",\n', ""],
  ],
  "app/calendar/page.js": [
    ['import { publicRegistrationEnabled } from "../../lib/public-registration-gate";\n', ""],
    ["<p className={styles.lead}>{publicRegistrationEnabled() ? intro.lead : intro.leadClosed}</p>", "<p className={styles.lead}>{intro.lead}</p>"],
  ],
  "app/insights/page.js": [
    ['import { newsletterEnabled } from "../../lib/newsletter-gate";\n', ""],
    ['<EbookPromo />{newsletterEnabled() && <div className="insights-newsletter-block">', '<EbookPromo /><div className="insights-newsletter-block">'],
    ["<NewsletterSignup /></div>}<LeadGenCta />", "<NewsletterSignup /></div><LeadGenCta />"],
  ],
};

// Release 2 S1 (owner-approved K-DEV and Option A, 19 Nov 2026): the V3-R-2 homepage hero copy. Exactly two named lines in
// content/en/home.js, undone here so the launch contract keeps proving the rest of the file (including the F-1
// registerCtaClosed edit) is unchanged. Any other change to the file, or a different wording here, still fails.
const R2_S1_EDITS: Record<string, [string, string][]> = {
  "content/en/home.js": [
    ['    lead: "Professional industrial training, competency development and consultancy solutions.",\n', '    lead: "Practical industrial training and workforce development for individuals and organisations.",\n'],
    ['    secondaryCta: { label: "Request a Proposal", href: "/request-proposal" },\n', '    secondaryCta: { label: "Corporate Training", href: "/corporate-training" },\n'],
  ],
};

// FT-1A-2 (owner-approved, 21 Nov 2026): the course-page enhancement, five named edits E1-E5. Undone first and each must
// be present exactly, so every contract built on revertPublicFirst keeps proving the rest of the file is unchanged
// (the pre-Public-First BEFORE hash in public-first-launch-contract.mts is not modified).
const FT1A_EDITS: Record<string, [string, string][]> = {
  "app/training/[slug]/page.js": [
    // E1: imports: course-photos, CourseFaq, CourseEnquiryPaths
    ["import { courseContent } from \"../../../content/en/course\";\nimport { coursePhoto } from \"../../../lib/course-photos\";\nimport CourseFaq from \"../../../components/course/CourseFaq\";\nimport CourseEnquiryPaths from \"../../../components/course/CourseEnquiryPaths\";\n", "import { courseContent } from \"../../../content/en/course\";\n"],
    // E2: hero: approved photograph right after the title on phones
    ["              <h1 id=\"course-title\" className={styles.title}>{course.title}</h1>\n              {coursePhoto(course.slug) && (\n                <figure className={`${styles.figure} ${styles.photoMobile}`}>\n                  <div className={styles.photo}><Image className={styles.photoImg} src={coursePhoto(course.slug).src} alt={coursePhoto(course.slug).alt} fill loading=\"eager\" sizes=\"(max-width: 960px) 100vw, 40vw\" style={{ objectPosition: coursePhoto(course.slug).position }} /></div>\n                  <figcaption className={styles.credit}>{text.photoCredit}</figcaption>\n                </figure>\n              )}\n", "              <h1 id=\"course-title\" className={styles.title}>{course.title}</h1>\n"],
    // E3: hero figure: approved photograph, otherwise the existing panel
    ["            {coursePhoto(course.slug) ? (\n              <figure className={`${styles.figure} ${styles.photoDesktop}`}>\n                <div className={styles.photo}><Image className={styles.photoImg} src={coursePhoto(course.slug).src} alt={coursePhoto(course.slug).alt} fill priority sizes=\"(max-width: 960px) 100vw, 40vw\" style={{ objectPosition: coursePhoto(course.slug).position }} /></div>\n                <figcaption className={styles.credit}>{text.photoCredit}</figcaption>\n              </figure>\n            ) : (\n              <figure className={styles.figure}>\n                <Image src={course.image} alt=\"\" unoptimized width={1200} height={800} priority sizes=\"(max-width: 960px) 100vw, 40vw\" />\n              </figure>\n            )}\n", "            <figure className={styles.figure}>\n              <Image src={course.image} alt=\"\" unoptimized width={1200} height={800} priority sizes=\"(max-width: 960px) 100vw, 40vw\" />\n            </figure>\n"],
    // E4: enquire action opens the page's #enquire section
    ["      <a className={`${kit.btn} ${kit.btnLight}`} href=\"#enquire\">{text.actions.enquire}</a>\n", "      <a className={`${kit.btn} ${kit.btnLight}`} href={enquiryHref({ course: course.slug, source })}>{text.actions.enquire}</a>\n"],
    // E5: published FAQs and the three enquiry routes before the final CTA band
    ["        ))}\n\n        <CourseFaq sectionClass={`${kit.px} ${kit.sec} ${styles.section} ${styles.plain}`} wrapClass={kit.wrap} />\n        <CourseEnquiryPaths course={{ slug: course.slug, title: course.title }} hasRegistration={hasRegistration} registerHref={scheduleHref} sectionClass={`${kit.px} ${kit.sec} ${kit.tone} ${styles.section} ${styles.tone}`} wrapClass={kit.wrap} primaryButton={kit.btn} lineButton={`${kit.btn} ${styles.btnLine}`} />\n", "        ))}\n"],
  ],
};

function revertFt1a(path: string, input: string): string {
  const crlf = input.includes("\r\n");
  const eol = (value: string) => (crlf ? value.replace(/\r?\n/g, "\r\n") : value);
  let out = input;
  for (const [now, before] of FT1A_EDITS[path] ?? []) {
    const from = eol(now);
    if (!out.includes(from)) throw new Error(`FT-1A: expected edit not found in ${path}`);
    out = out.replace(from, () => eol(before));
  }
  return out;
}

// F-5: files whose literal canonical host became CANONICAL_ORIGIN.
export const PF_CANONICAL_FILES = ["app/layout.js", "app/sitemap.js", "app/robots.js", "app/about/layout.js", "app/contact/layout.js", "app/gallery/layout.js", "app/services/layout.js", "app/services/scaffolding/layout.js", "app/training/layout.js", "app/insights/[slug]/page.js", "app/training/[slug]/page.js", "components/public/BreadcrumbJsonLd.js"];

/** Every pre-existing file the Public-First fixes changed. */
export const PF_CHANGED = [...new Set([...Object.keys(PANELS), ...Object.keys(EDITS), ...PF_CANONICAL_FILES])].sort();
/** New files added by the Public-First fixes. */
export const PF_ADDED = ["lib/canonical-origin.js", "lib/newsletter-gate.js", "lib/public-registration-gate.ts", "scripts/fixtures/public-registration-gate-fakes.mjs", "scripts/public-first-approved.mts", "scripts/public-first-launch-contract.mts", "scripts/public-registration-kill-switch.test.mts", "scripts/public-first-g2-return.test.mts"];
/** Tracked files removed from public/ (F-2/F-3); byte-identical copies are kept outside the repository. */
export const PF_WITHHELD = ["public/images/scaffolding-rental-poster-en.webp"];

function revertCanonical(text: string): string {
  return text
    .replace(/^import \{ CANONICAL_ORIGIN \} from "[./]+lib\/canonical-origin";\r?\n/m, "")
    .replace(/`\$\{CANONICAL_ORIGIN\}([^`$]*)`/g, (_m, rest) => `"${HOST}${rest}"`)
    .replace(/\$\{CANONICAL_ORIGIN\}/g, HOST)
    .replace(/\bCANONICAL_ORIGIN\b/g, `"${HOST}"`);
}

export function revertPublicFirst(path: string, input: string): string {
  // W2-A (owner-approved): the public-address edits are undone first (scripts/w2a-address-approved.mts), so every
  // contract built on this function keeps proving the rest of each file is unchanged.
  // FT-1A-2 (owner-approved): the course-page edits are undone before everything else (latest change first).
  // W3-a (owner-approved, scripts/w3-approved.mts) is later still, so it is undone first of all.
  // W7-a (owner-approved W7-a-G1, scripts/w7-approved.mts) is the latest change to lib/public-content.ts, so it is
  // undone before W3-a.
  // W6-SEO-a1 (owner-approved, scripts/w6seo-approved.mts) is the latest change of all, so it is undone first.
  input = revertW6seo(path, input);
  input = revertW7(path, input);
  input = revertW3(path, input);
  // W4-a (owner-approved, W4-a-G1): the QA remediation edits are the latest change, so they are undone first
  // (scripts/w4a-approved.mts).
  input = revertW4a(path, input);
  const text = revertW2aAddress(path, revertFt1a(path, input));
  const crlf = text.includes("\r\n");
  const eol = (s: string) => (crlf ? s.replace(/\r?\n/g, "\r\n") : s);
  let out = PF_CANONICAL_FILES.includes(path) ? revertCanonical(text) : text;
  for (const [now, before] of R2_S1_EDITS[path] ?? []) {
    const from = eol(now);
    if (!out.includes(from)) throw new Error(`release-2 S1: expected edit not found in ${path}`);
    out = out.replace(from, eol(before));
  }
  for (const [now, before] of EDITS[path] ?? []) {
    const from = eol(now);
    if (!out.includes(from)) throw new Error(`public-first: expected edit not found in ${path}`);
    out = out.replace(from, eol(before));
  }
  for (const [now, before] of PANELS[path] ?? []) {
    if (!out.includes(now)) throw new Error(`public-first: expected panel not found in ${path}`);
    out = out.replace(now, before);
  }
  return out;
}
