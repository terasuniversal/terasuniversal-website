import Footer from "../components/Footer";
import PremiumHeader from "../components/premium/PremiumHeader";
import { courseCatalog } from "../data/courseCatalog";
import { getUpcomingSchedules } from "../lib/public-content";
import HomeHero from "../components/home/HomeHero";
import CoreProgrammes from "../components/home/CoreProgrammes";
import CourseCatalogue from "../components/home/CourseCatalogue";
import UpcomingDates from "../components/home/UpcomingDates";
import DeliveryOptions from "../components/home/DeliveryOptions";
import Recognition from "../components/home/Recognition";
import HomeFaq from "../components/home/HomeFaq";
import HomeContact from "../components/home/HomeContact";
import LegacyAnchors from "../components/home/LegacyAnchors";
import kit from "../components/premium/premium.module.css";

const dateLabel = (date) => new Intl.DateTimeFormat("en-MY", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${date}T00:00:00`));

const timeLabel = (time) => new Intl.DateTimeFormat("en-MY", { hour: "numeric", minute: "2-digit" }).format(new Date(`2000-01-01T${time}`));

const scheduleStatusLabel = (status) => ({
  open: "Open",
  full: "Full",
  in_progress: "In Progress",
  completed: "Completed",
  cancelled: "Cancelled",
}[status] ?? status);

// Resolve schedule cards through the catalogue's stable CRM identity first.
// The RPC slug is a database value and may use the canonical CRM naming,
// while the public catalogue can intentionally use a different route slug.
const publicScheduleSlug = (session) => {
  const byCrmId = courseCatalog.find((course) => course.crmCourseId && course.crmCourseId === session.course_id);
  if (byCrmId) return byCrmId.slug;
  return courseCatalog.find((course) => course.slug === session.slug)?.slug ?? null;
};

export default async function HomePage() {
  const upcomingSchedules = await getUpcomingSchedules();
  const scheduleRows = upcomingSchedules.map((session) => {
    const scheduleSlug = publicScheduleSlug(session);
    const hasEnd = session.end_date && session.end_date !== session.start_date;
    return {
      id: session.id,
      startDate: session.start_date,
      dateText: `${dateLabel(session.start_date)}${hasEnd ? ` – ${dateLabel(session.end_date)}` : ""}`,
      timeText: session.start_time ? timeLabel(session.start_time) : "",
      title: session.title,
      meta: [session.delivery_mode, session.venue].filter(Boolean).join(" · ") || "Venue to be confirmed",
      status: session.status,
      statusLabel: scheduleStatusLabel(session.status),
      href: scheduleSlug ? `/training/${scheduleSlug}` : `/request-proposal?source=homepage-schedule&session=${encodeURIComponent(session.start_date)}`,
      linkLabel: scheduleSlug ? "View Course Details" : "Enquire About This Session",
    };
  });

  return (
    <>
      <PremiumHeader />
      <main className={kit.px}>
        <LegacyAnchors />
        <HomeHero />
        <CoreProgrammes />
        <section id="courses" className={`${kit.sec} ${kit.secFollow}`} aria-labelledby="courses-title">
          <div className={kit.wrap}>
            <div className={kit.kicker}>
              <h2 id="courses-title">All courses</h2>
              <p>Every course, how long it runs and how it is delivered.</p>
            </div>
            <UpcomingDates rows={scheduleRows} />
            <CourseCatalogue />
            <p className={kit.links}><a className={kit.tl} href="/training">All course details</a></p>
          </div>
        </section>
        <DeliveryOptions />
        <Recognition />
        <HomeFaq />
        <HomeContact />
      </main>
      <Footer />
    </>
  );
}
