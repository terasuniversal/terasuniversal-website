import Image from "next/image";
import MobileNav from "../components/MobileNav";
import MegaNav from "../components/MegaNav";
import Footer from "../components/Footer";
import { courseCatalog } from "../data/courseCatalog";
import { getUpcomingSchedules } from "../lib/public-content";
import HomeHero from "../components/home/HomeHero";
import CoreProgrammes from "../components/home/CoreProgrammes";
import CourseTable from "../components/home/CourseTable";
import UpcomingDates from "../components/home/UpcomingDates";
import DeliveryOptions from "../components/home/DeliveryOptions";
import Recognition from "../components/home/Recognition";
import HomeFaq from "../components/home/HomeFaq";
import HomeContact from "../components/home/HomeContact";
import HomeReveal from "../components/home/HomeReveal";
import LegacyAnchors from "../components/home/LegacyAnchors";
import styles from "../components/home/home.module.css";

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
    <main>
      <div className="brand-topbar">
        <div className="container brand-topbar-inner">
          <span>Industrial Safety Training &amp; Technical Competency</span>
          <div>
            <a href="tel:+60195193834">+60 19-519 3834</a>
            <a href="mailto:training@terasuniversal.com.my">training@terasuniversal.com.my</a>
          </div>
        </div>
      </div>
      <header className="site-header">
        <div className="container nav-wrap">
          <a className="brand" href="#home" aria-label="TERAS UNIVERSAL home">
            <Image src="/teras-universal-logo.png" alt="TERAS UNIVERSAL logo" width={220} height={140} priority sizes="154px" />
          </a>
          <MegaNav />
          <MobileNav />
        </div>
      </header>

      <div className={styles.home}>
        <HomeReveal />
        <LegacyAnchors />
        <HomeHero />
        <CoreProgrammes />
        <section id="courses" className={styles.courses} aria-labelledby="courses-title">
          <div className={styles.axis}>
            <h2 id="courses-title" className={styles.h2}>All courses</h2>
            <p className={styles.intro}>Every course, how long it runs and how it is delivered.</p>
          </div>
          <UpcomingDates rows={scheduleRows} />
          <CourseTable />
          <p className={styles.more}><a className={styles.tl} href="/training">All course details</a></p>
          <DeliveryOptions />
        </section>
        <Recognition />
        <HomeFaq />
        <HomeContact />
      </div>

      <Footer />
    </main>
  );
}
