import { notFound } from "next/navigation";
import Footer from "../../../components/Footer";
import Recognition from "../../../components/home/Recognition";
import CtaBand from "../../../components/premium/CtaBand";
import FactLedger from "../../../components/premium/FactLedger";
import InnerHero from "../../../components/premium/InnerHero";
import Outline from "../../../components/premium/Outline";
import PremiumHeader from "../../../components/premium/PremiumHeader";
import ProgrammeRow from "../../../components/premium/ProgrammeRow";
import SectionHead from "../../../components/premium/SectionHead";
import kit from "../../../components/premium/premium.module.css";
import inner from "../../../components/premium/inner.module.css";
import BreadcrumbJsonLd from "../../../components/public/BreadcrumbJsonLd";
import PrimaryCtaGroup from "../../../components/public/PrimaryCtaGroup";
import CourseScheduleOptions from "../../../components/public/CourseScheduleOptions";
import RelatedIndustries from "../../../components/public/RelatedIndustries";
import { courseCatalog, findCourse } from "../../../data/courseCatalog";
import { getPublicCourseIdentity, getPublishedSchedulesWithState } from "../../../lib/public-content";
import { sessionKind } from "../../../lib/session-display";

export function generateStaticParams() { return courseCatalog.map(({ slug }) => ({ slug })); }
// Only catalogue slugs exist. Rejecting others at routing time is what makes
// them a real HTTP 404: app/loading.js streams the page, so a notFound() thrown
// during render arrives after a 200 status has already been sent.
export const dynamicParams = false;
export const revalidate = 60;
export async function generateMetadata({ params }) { const { slug } = await params; const course = findCourse(slug); return course ? { title: course.title, description: course.summary, alternates: { canonical: `/training/${course.slug}` }, openGraph: { title: `${course.title} | TERAS UNIVERSAL`, description: course.summary, url: `/training/${course.slug}` } } : { title: "Training Programme | TERAS UNIVERSAL" }; }

function toIsoDuration(duration) { const match = /^(\d+)\s*Days?$/i.exec((duration || "").trim()); return match ? `P${match[1]}D` : undefined; }
function courseSchema(course) { const isoDuration = toIsoDuration(course.duration); return { "@context": "https://schema.org", "@type": "Course", name: course.title, description: course.summary, url: `https://terasuniversal.com.my/training/${course.slug}`, provider: { "@type": "Organization", name: "TERAS UNIVERSAL SDN. BHD.", sameAs: "https://www.terasuniversal.com.my" }, ...(isoDuration ? { hasCourseInstance: { "@type": "CourseInstance", courseMode: ["Blended", "onsite"], courseWorkload: isoDuration } } : {}) }; }

export default async function CoursePage({ params }) {
  const { slug } = await params;
  const course = findCourse(slug);
  if (!course) notFound();

  const relatedCourses = (course.related || []).map((reference) => findCourse(reference) || courseCatalog.find((item) => item.title === reference)).filter(Boolean);
  const [{ schedules: publicSchedules, error: scheduleLoadError }, canonicalCourse] = await Promise.all([getPublishedSchedulesWithState(), getPublicCourseIdentity(course.slug)]);
  // Prefer the explicit stable CRM identity when the public marketing slug
  // differs from the canonical CRM slug/title. Legacy entries may resolve via
  // the published database slug; exact title matching is compatibility-only.
  const courseSchedules = publicSchedules.filter((session) => (
    course.crmCourseId || canonicalCourse
      ? session.course_id === (course.crmCourseId || canonicalCourse.id)
      : session.slug === course.slug || session.title === course.title
  ) && session.start_date >= new Date().toISOString().slice(0, 10));
  const hasRegistration = courseSchedules.some((session) => sessionKind(session) === "open");
  const courseId = canonicalCourse?.id || courseSchedules[0]?.course_id;
  // Direct registration link only when the course has exactly one session and that session is registrable.
  const scheduleHref = courseSchedules.length === 1 && sessionKind(courseSchedules[0]) === "open"
    ? `/registration/${courseSchedules[0].id}`
    : courseId
      ? `/calendar?courseId=${encodeURIComponent(courseId)}`
      : `/calendar?course=${encodeURIComponent(course.slug)}`;

  const sameList = JSON.stringify(course.objectives) === JSON.stringify(course.modules);
  const facts = [["Duration", course.duration], ["Delivery", course.deliveryMode], ["Assessment", course.assessment], ["Completion", course.completion]];

  return (
    <>
      <PremiumHeader />
      <main className={`${kit.px} ${inner.page}`}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(courseSchema(course)) }} />
      <BreadcrumbJsonLd items={[{ name: "Home", path: "/" }, { name: "Training", path: "/training" }, { name: course.title, path: `/training/${course.slug}` }]} />

      <InnerHero
        crumbs={[{ label: "Home", href: "/" }, { label: "Training", href: "/training" }, { label: course.title }]}
        eyebrow={course.category}
        title={course.title}
        lead={course.summary}
        actions={<PrimaryCtaGroup course={course} source="course-page" scheduleHref={scheduleHref} hasRegistration={hasRegistration} />}
        facts={[["Duration", course.duration], ["Delivery", course.deliveryMode]]}
      />

      <CourseScheduleOptions sessions={courseSchedules} loadError={scheduleLoadError} courseSlug={course.slug} />

      <section className={kit.sec} aria-labelledby="course-details-title"><div className={`${kit.wrap} ${inner.twoCol}`}><div><span className={`${inner.eyebrow} ${inner.onLight}`}>Course Overview</span><h2 id="course-details-title">Course details</h2><p>{course.summary}</p><FactLedger facts={facts} /></div>{course.audience?.length > 0 && <aside className={inner.aside} aria-labelledby="attend-title"><span className={`${inner.eyebrow} ${inner.onLight}`}>Who Should Attend</span><h3 id="attend-title" className="sr-only">Who should attend</h3><ul>{course.audience.map((item) => <li key={item}>{item}</li>)}</ul></aside>}</div></section>

      {course.objectives?.length > 0 && <section className={`${kit.sec} ${kit.trust}`} aria-labelledby="objectives-title"><div className={kit.wrap}><SectionHead id="objectives-title" eyebrow={sameList ? "Learning Objectives and Course Outline" : "Learning Objectives"} title="What participants will build." /><Outline items={course.objectives} label="Learning objectives" /></div></section>}
      {course.entryRequirements?.length > 0 && <section className={kit.sec} aria-labelledby="entry-title"><div className={kit.wrap}><SectionHead id="entry-title" eyebrow="Entry Requirements" title="Before attending." /><Outline items={course.entryRequirements} check single label="Entry requirements" /></div></section>}
      {course.modules?.length > 0 && !sameList && <section className={`${kit.sec} ${kit.trust}`} aria-labelledby="modules-title"><div className={kit.wrap}><SectionHead id="modules-title" eyebrow="Course Outline" title="Learning modules" /><Outline items={course.modules} label="Learning modules" /></div></section>}

      <CtaBand id="course-cta-title" eyebrow="Upcoming Training" title={`Looking for a date for ${course.title}?`} text="Review confirmed public sessions or send an enquiry for your workforce. Registration is arranged with the TERAS team.">
        <PrimaryCtaGroup course={course} source="course-final-cta" scheduleHref={scheduleHref} hasRegistration={hasRegistration} />
      </CtaBand>
      <RelatedIndustries courseSlug={course.slug} />
      {relatedCourses.length > 0 && <section className={kit.sec} aria-labelledby="related-courses-title"><div className={kit.wrap}><SectionHead id="related-courses-title" eyebrow="Related Courses" title="Continue your competency pathway." /><ul className={kit.idx}>{relatedCourses.map((relatedCourse) => <ProgrammeRow key={relatedCourse.slug} course={relatedCourse} />)}</ul></div></section>}
      <Recognition />
      </main>
      <Footer />
    </>
  );
}
