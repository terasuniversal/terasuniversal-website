import Image from "next/image";
import { notFound } from "next/navigation";
import PremiumHeader from "../../../components/premium/PremiumHeader";
import { publicBody } from "../../../components/premium/fonts";
import kit from "../../../components/premium/premium.module.css";
import styles from "../../../components/course/course.module.css";
import PremiumFooter from "../../../components/premium/PremiumFooter";
import BreadcrumbJsonLd from "../../../components/public/BreadcrumbJsonLd";
import { enquiryHref } from "../../../components/public/PrimaryCtaGroup";
import CourseSessions from "../../../components/course/CourseSessions";
import { courseContent } from "../../../content/en/course";
import { courseCatalog, findCourse } from "../../../data/courseCatalog";
import { industries } from "../../../data/industries";
import { insights } from "../../../data/insights";
import { getPublicCourseIdentity, getPublishedSchedulesWithState } from "../../../lib/public-content";
import { sessionKind } from "../../../lib/session-display";
import { sessionsForCourse } from "../../../lib/course-session-map";
import { socialMetadata } from "../../../lib/social-metadata";
import { CANONICAL_ORIGIN } from "../../../lib/canonical-origin";

export function generateStaticParams() { return courseCatalog.map(({ slug }) => ({ slug })); }
// Only catalogue slugs exist. Rejecting others at routing time is what makes
// them a real HTTP 404: app/loading.js streams the page, so a notFound() thrown
// during render arrives after a 200 status has already been sent.
export const dynamicParams = false;
export const revalidate = 60;
export async function generateMetadata({ params }) { const { slug } = await params; const course = findCourse(slug); return course ? { title: course.title, description: course.summary, alternates: { canonical: `/training/${course.slug}` }, ...socialMetadata({ title: `${course.title} | TERAS UNIVERSAL`, description: course.summary, path: `/training/${course.slug}` }) } : { title: "Training Programme | TERAS UNIVERSAL" }; }

function toIsoDuration(duration) { const match = /^(\d+)\s*Days?$/i.exec((duration || "").trim()); return match ? `P${match[1]}D` : undefined; }
function courseSchema(course) { const isoDuration = toIsoDuration(course.duration); return { "@context": "https://schema.org", "@type": "Course", name: course.title, description: course.summary, url: `${CANONICAL_ORIGIN}/training/${course.slug}`, provider: { "@type": "Organization", name: "TERAS UNIVERSAL SDN. BHD.", sameAs: "https://www.terasuniversal.com.my" }, ...(isoDuration ? { hasCourseInstance: { "@type": "CourseInstance", courseMode: ["Blended", "onsite"], courseWorkload: isoDuration } } : {}) }; }

// A catalogue fact is shown only when it is stated; "to be confirmed" wording is left out (the pre-S4B CourseFactList rule).
const verifiedFacts = (course, keys) => courseContent.facts.filter(([, key]) => keys.includes(key) && Boolean(course[key]) && !String(course[key]).toLowerCase().includes("to be confirmed"));

// Hybrid Premium V2 course-detail page (Phase S4B): the shared Premium Navy header, a navy course hero, the public
// sessions (shared session policy), the verified catalogue content and the enquiry pathways. Every course fact is the
// catalogue's own wording; nothing about qualifications, accreditation or certification eligibility is added here.
export default async function CoursePage({ params }) {
  const { slug } = await params;
  const course = findCourse(slug);
  if (!course) notFound();

  const relatedCourses = (course.related || []).map((reference) => findCourse(reference) || courseCatalog.find((item) => item.title === reference)).filter(Boolean);
  const relatedIndustries = industries.filter((industry) => industry.relevantCourseSlugs.includes(course.slug));
  const relatedArticles = insights.filter((article) => Array.isArray(article.body) && (article.relatedCourses || []).includes(`/training/${course.slug}`));
  const [{ schedules: publicSchedules, error: scheduleLoadError }, canonicalCourse] = await Promise.all([getPublishedSchedulesWithState(), getPublicCourseIdentity(course.slug)]);
  // Prefer the explicit stable CRM identity when the public marketing slug
  // differs from the canonical CRM slug/title. Legacy entries may resolve via
  // the published database slug; exact title matching is compatibility-only.
  // Since S4B the matching rule lives in lib/course-session-map.ts; the upcoming-date filter stays here.
  const courseSchedules = sessionsForCourse(course, canonicalCourse, publicSchedules).filter((session) => session.start_date >= new Date().toISOString().slice(0, 10));
  // Same Register decision as the session cards, the calendar and the homepage (lib/session-display.ts): it needs the
  // server's registration_available flag and only ever withholds Register from an inconsistent record.
  const hasRegistration = courseSchedules.some((session) => sessionKind(session) === "open");
  const courseId = canonicalCourse?.id || courseSchedules[0]?.course_id;
  const scheduleHref = courseSchedules.length === 1 && hasRegistration
    ? `/registration/${courseSchedules[0].id}`
    : courseId
      ? `/calendar?courseId=${encodeURIComponent(courseId)}`
      : `/calendar?course=${encodeURIComponent(course.slug)}`;

  const text = courseContent;
  const heroFacts = verifiedFacts(course, ["duration", "deliveryMode"]);
  const detailFacts = verifiedFacts(course, ["duration", "deliveryMode", "assessment", "completion"]);
  // Content sections alternate between the plain and the tone ground, whichever of them the catalogue fills.
  const bands = [
    course.objectives?.length > 0 && { key: "objectives", eyebrow: text.objectives.eyebrow, title: text.objectives.title, items: course.objectives, kind: "numbered" },
    course.entryRequirements?.length > 0 && { key: "entry", eyebrow: text.entry.eyebrow, title: text.entry.title, items: course.entryRequirements, kind: "checklist" },
    course.modules?.length > 0 && { key: "modules", eyebrow: text.modules.eyebrow, title: text.modules.title, items: course.modules, kind: "numbered" },
  ].filter(Boolean);
  const actions = (source) => (
    <div className={styles.acts}>
      <a className={kit.btn} href={scheduleHref}>{hasRegistration ? text.actions.register : text.actions.upcoming}</a>
      <a className={`${kit.btn} ${kit.btnLight}`} href={enquiryHref({ course: course.slug, source })}>{text.actions.enquire}</a>
      <a className={`${kit.btn} ${kit.btnLight}`} href={text.actions.whatsappHref(course.title)} target="_blank" rel="noreferrer">{text.actions.whatsapp}</a>
    </div>
  );

  return (
    <>
      <PremiumHeader registerHref={courseSchedules.length > 0 ? "#course-sessions" : scheduleHref} />
      <main className={publicBody.variable}>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(courseSchema(course)) }} />
        <BreadcrumbJsonLd items={[{ name: "Home", path: "/" }, { name: "Training", path: "/training" }, { name: course.title, path: `/training/${course.slug}` }]} />

        <section className={`${kit.px} ${kit.navyField} ${styles.hero}`} aria-labelledby="course-title">
          <div className={`${kit.wrap} ${styles.heroGrid}`}>
            <div>
              <nav className={styles.crumbs} aria-label={text.breadcrumb.label}>
                <a href="/">{text.breadcrumb.home}</a><span aria-hidden="true">/</span>
                <a href="/training">{text.breadcrumb.training}</a><span aria-hidden="true">/</span>
                <span aria-current="page">{course.title}</span>
              </nav>
              <p className={styles.heroEyebrow}>{course.category}</p>
              <h1 id="course-title" className={styles.title}>{course.title}</h1>
              <p className={styles.summary}>{course.summary}</p>
              {heroFacts.length > 0 && (
                <dl className={styles.keyFacts}>
                  {heroFacts.map(([label, key]) => <div key={key}><dt>{label}</dt><dd>{course[key]}</dd></div>)}
                </dl>
              )}
              {actions("course-page")}
            </div>
            <figure className={styles.figure}>
              <Image src={course.image} alt="" unoptimized width={1200} height={800} priority sizes="(max-width: 960px) 100vw, 40vw" />
            </figure>
          </div>
        </section>

        <CourseSessions sessions={courseSchedules} loadError={scheduleLoadError} courseSlug={course.slug} />

        <section className={`${kit.px} ${kit.sec} ${styles.section} ${styles.overview}`} aria-labelledby="course-overview-title">
          <div className={`${kit.wrap} ${styles.overviewGrid}`}>
            <div>
              <p className={styles.eyebrow}>{text.overview.eyebrow}</p>
              <h2 id="course-overview-title">{text.overview.title}</h2>
              <p className={styles.summary}>{course.summary}</p>
              {detailFacts.length > 0 && (
                <dl className={styles.factGrid}>
                  {detailFacts.map(([label, key]) => <div key={key}><dt>{label}</dt><dd>{course[key]}</dd></div>)}
                </dl>
              )}
            </div>
            {course.audience?.length > 0 && (
              <aside className={styles.audience} aria-label={text.audience.eyebrow}>
                <p className={styles.eyebrow}>{text.audience.eyebrow}</p>
                <ul>{course.audience.map((item) => <li key={item}>{item}</li>)}</ul>
              </aside>
            )}
          </div>
        </section>

        {bands.map((band, index) => (
          <section key={band.key} className={`${kit.px} ${kit.sec} ${styles.section} ${index % 2 === 0 ? `${kit.tone} ${styles.tone}` : styles.plain}`} aria-labelledby={`course-${band.key}-title`}>
            <div className={kit.wrap}>
              <p className={styles.eyebrow}>{band.eyebrow}</p>
              <h2 id={`course-${band.key}-title`}>{band.title}</h2>
              {band.kind === "numbered"
                ? <ol className={styles.numbered}>{band.items.map((item) => <li key={item}><span>{item}</span></li>)}</ol>
                : <ul className={styles.checklist}>{band.items.map((item) => <li key={item}>{item}</li>)}</ul>}
            </div>
          </section>
        ))}

        <section className={`${kit.px} ${kit.sec} ${kit.navyField}`} aria-labelledby="course-final-title">
          <div className={`${kit.wrap} ${styles.final}`}>
            <div>
              <p className={styles.finalEyebrow}>{text.final.eyebrow}</p>
              <h2 id="course-final-title">{text.final.title(course.title)}</h2>
              <p className={styles.finalText}>{text.final.text}</p>
            </div>
            {actions("course-final-cta")}
          </div>
        </section>

        {relatedIndustries.length > 0 && (
          <section className={`${kit.px} ${kit.sec} ${styles.section} ${styles.plain}`} aria-labelledby="related-industries-title">
            <div className={kit.wrap}>
              <p className={styles.eyebrow}>{text.industries.eyebrow}</p>
              <h2 id="related-industries-title">{text.industries.title}</h2>
              <p className={styles.sectionText}>{text.industries.text}</p>
              <ul className={styles.cards}>
                {relatedIndustries.map((industry) => (
                  <li className={styles.card} key={industry.slug}>
                    <p className={styles.eyebrow}>{text.industries.cardEyebrow}</p>
                    <h3><a className={styles.cardLink} href={`/industries/${industry.slug}`}>{industry.name}</a></h3>
                    <p className={styles.cardText}>{industry.summary}</p>
                    <span className={styles.cardMore} aria-hidden="true">{text.industries.more}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        {relatedCourses.length > 0 && (
          <section className={`${kit.px} ${kit.sec} ${kit.tone} ${styles.section}`} aria-labelledby="related-courses-title">
            <div className={kit.wrap}>
              <p className={styles.eyebrow}>{text.related.eyebrow}</p>
              <h2 id="related-courses-title">{text.related.title}</h2>
              <ul className={styles.cards}>
                {relatedCourses.map((related) => (
                  <li className={styles.card} key={related.slug}>
                    <p className={styles.eyebrow}>{related.category}</p>
                    <h3><a className={styles.cardLink} href={`/training/${related.slug}`}>{related.title}</a></h3>
                    <p className={styles.cardText}>{related.summary}</p>
                    {related.audience?.length > 0 && <p className={styles.cardMeta}>{text.related.audience}: {related.audience.slice(0, 3).join(", ")}</p>}
                    <span className={styles.cardMore} aria-hidden="true">{text.related.more}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        {relatedArticles.length > 0 && (
          <section className={`${kit.px} ${kit.sec} ${styles.section} ${styles.plain}`} aria-labelledby="related-reading-title">
            <div className={kit.wrap}>
              <p className={styles.eyebrow}>{text.reading.eyebrow}</p>
              <h2 id="related-reading-title">{text.reading.title}</h2>
              <ul className={styles.cards}>
                {relatedArticles.map((article) => (
                  <li className={styles.card} key={article.slug}>
                    <p className={styles.eyebrow}>{article.category}</p>
                    <h3><a className={styles.cardLink} href={`/insights/${article.slug}`}>{article.title}</a></h3>
                    <p className={styles.cardText}>{article.excerpt}</p>
                    <span className={styles.cardMore} aria-hidden="true">{text.reading.more}</span>
                  </li>
                ))}
              </ul>
              <a className={kit.tl} href="/insights">{text.reading.all}</a>
            </div>
          </section>
        )}
      </main>
        <PremiumFooter />
    </>
  );
}
