import PremiumFooter from "../components/premium/PremiumFooter";
import PremiumHeader from "../components/premium/PremiumHeader";
import { publicBody } from "../components/premium/fonts";
import { courseCatalog } from "../data/courseCatalog";
import { getUpcomingSchedules } from "../lib/public-content";
import { describeSession } from "../lib/session-display";
import { catalogueCourseForSession, catalogueDurationText } from "../lib/course-session-map";
import { enquiryHref } from "../components/public/PrimaryCtaGroup";
import HomeHero from "../components/home/HomeHero";
import CoreProgrammes from "../components/home/CoreProgrammes";
import UpcomingDates from "../components/home/UpcomingDates";
import DeliveryOptions from "../components/home/DeliveryOptions";
import Recognition from "../components/home/Recognition";
import HomeFaq from "../components/home/HomeFaq";
import HomeContact from "../components/home/HomeContact";
import HomeReveal from "../components/home/HomeReveal";
import LegacyAnchors from "../components/home/LegacyAnchors";
import styles from "../components/home/home.module.css";
import { homeContent } from "../content/en/home";

// Resolve schedule cards through the catalogue's stable CRM identity first.
// The RPC slug is a database value and may use the canonical CRM naming,
// while the public catalogue can intentionally use a different route slug.
// Since S4B the rule lives in lib/course-session-map.ts, shared with the calendar and course pages.
const publicScheduleCourse = (session) => catalogueCourseForSession(session, courseCatalog);
// W8-H-a: catalogue courses that no programme card covers, so every course is still named and linked on the homepage now
// that the "All courses" table is not rendered.
const coveredByCards = new Set(homeContent.courses.items.flatMap((item) => item.catalogSlugs));
const moreCourses = courseCatalog.filter((course) => !coveredByCards.has(course.slug));

export default async function HomePage() {
  const upcomingSchedules = await getUpcomingSchedules();
  // Labels, fee, venue fallback, availability and the action come from the shared session policy (lib/session-display.ts),
  // the same one the training calendar and course pages use. The duration is the catalogue's own value, shown only when
  // the catalogue states it as a number of days.
  const scheduleRows = upcomingSchedules.map((session) => {
    const course = publicScheduleCourse(session);
    const scheduleSlug = course?.slug ?? null;
    const view = describeSession(session);
    const actionHref = view.action.type === "register"
      ? view.action.href
      : view.action.type === "details" && scheduleSlug
        ? `/training/${scheduleSlug}`
        : enquiryHref({ course: scheduleSlug ?? undefined, session: session.start_date, source: "homepage-sessions" });
    return {
      id: session.id,
      startDate: session.start_date,
      dayText: view.dayText,
      dateText: view.dateText,
      timeText: view.timeText,
      title: session.title,
      courseHref: scheduleSlug ? `/training/${scheduleSlug}` : null,
      duration: catalogueDurationText(course),
      statusLabel: view.state === "open" ? view.seatsText : view.statusLabel,
      venueText: view.venueText,
      feeShort: view.feeShort,
      feeAmount: view.feeAmount,
      feeUnit: view.feeUnit,
      actionType: view.action.type,
      actionHref,
      actionLabel: view.action.shortLabel,
      actionAria: `${view.action.label}: ${session.title}, ${view.dateText}`,
    };
  });

  // The shared header sits before <main> so it is the page's banner landmark. The R3 hero and programme cards render
  // outside the legacy .home wrapper, so its heading and font rules cannot compete with the public kit; the sections
  // after them are unchanged in this slice.
  return (
    <>
      <PremiumHeader registerHref="#upcoming-training" />
      <main className={publicBody.variable}>
      <HomeHero />
      <CoreProgrammes />
      <UpcomingDates rows={scheduleRows} />
      <div className={styles.home}>
        <HomeReveal />
        <LegacyAnchors />
        {/* W8-H-a (owner-approved): the "All courses" table repeated the programme cards above and the /training catalogue,
            so it is no longer rendered here (components/home/CourseTable.js is kept). One line still names and links every
            course without a card, the section keeps its #courses id for old links, and a visually hidden h2 keeps the
            heading order for the delivery block below. */}
        <section id="courses" className={styles.courses} aria-labelledby="courses-title">
          <h2 id="courses-title" className="sr-only">More courses and training delivery</h2>
          <p className={styles.intro}>Also available: {moreCourses.map((course, index) => <span key={course.slug}>{index > 0 ? ", " : ""}<a className={styles.tl} href={`/training/${course.slug}`}>{course.title}</a></span>)}. <a className={styles.tl} href="/training">All course details</a></p>
          <DeliveryOptions />
        </section>
        <Recognition />
        <HomeFaq />
        <HomeContact />
      </div>
      </main>

      <PremiumFooter />
    </>
  );
}
