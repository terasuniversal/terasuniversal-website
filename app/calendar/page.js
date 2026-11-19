import PremiumHeader from "../../components/premium/PremiumHeader";
import { publicBody } from "../../components/premium/fonts";
import kit from "../../components/premium/premium.module.css";
import styles from "../../components/calendar/calendar.module.css";
import PremiumFooter from "../../components/premium/PremiumFooter";
import TrainingCalendar from "../../components/TrainingCalendar";
import { calendarContent } from "../../content/en/calendar";
import { courseCatalog } from "../../data/courseCatalog";
import { getPublishedSchedulesWithState } from "../../lib/public-content";
import { publicRegistrationEnabled } from "../../lib/public-registration-gate";
import { catalogueCourseForSession, catalogueDurationText } from "../../lib/course-session-map";
import { socialMetadata } from "../../lib/social-metadata";

export const metadata = { title: calendarContent.meta.title, description: calendarContent.meta.description, alternates: { canonical: "/calendar" }, ...socialMetadata({ title: `${calendarContent.meta.title} | TERAS UNIVERSAL`, description: calendarContent.meta.description, path: "/calendar" }) };

// Hybrid Premium V2 Training Calendar (Phase S4A): the shared Premium Navy header, a navy page intro, the calendar on the
// tone ground and a closing enquiry section. Data fetching, filters and views are unchanged (TrainingCalendar).
export default async function CalendarPage({ searchParams }) {
  const { schedules, error: scheduleLoadError } = await getPublishedSchedulesWithState();
  const { course, courseId } = await searchParams;
  // Catalogue course for each schedule (CRM identity first, then the public slug; lib/course-session-map.ts, shared with
  // the homepage and course pages). Only presentation fields are added; the schedule records pass through unchanged.
  const sessions = schedules.map((session) => {
    const entry = catalogueCourseForSession(session, courseCatalog);
    return { ...session, courseSlug: entry?.slug ?? null, duration: catalogueDurationText(entry) };
  });
  const { intro, cta } = calendarContent;
  return (
    <>
      <PremiumHeader registerHref="#calendar-sessions" />
      <main className={publicBody.variable}>
        <section className={`${kit.px} ${kit.navyField} ${styles.intro}`} aria-labelledby="calendar-page-title">
          <div className={kit.wrap}>
            <p className={styles.introEyebrow}>{intro.eyebrow}</p>
            <h1 id="calendar-page-title" className={styles.title}>{intro.title}</h1>
            <p className={styles.lead}>{publicRegistrationEnabled() ? intro.lead : intro.leadClosed}</p>
          </div>
        </section>
        <TrainingCalendar sessions={sessions} loadError={scheduleLoadError} courseSlug={typeof course === "string" ? course : undefined} courseId={typeof courseId === "string" ? courseId : undefined} />
        <section className={`${kit.px} ${kit.sec} ${kit.navyField}`} aria-labelledby="calendar-cta-title">
          <div className={`${kit.wrap} ${styles.cta}`}>
            <div>
              <h2 id="calendar-cta-title">{cta.title}</h2>
              <p className={styles.ctaText}>{cta.text}</p>
            </div>
            <div className={styles.ctaActs}>
              <a className={kit.btn} href={cta.primary.href}>{cta.primary.label}</a>
              <a className={`${kit.btn} ${kit.btnLight}`} href={cta.whatsapp.href} target="_blank" rel="noreferrer">{cta.whatsapp.label}</a>
              <a className={kit.tl} href={cta.corporate.href}>{cta.corporate.label}</a>
            </div>
          </div>
        </section>
      </main>
        <PremiumFooter />
    </>
  );
}
