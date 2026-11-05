import { Suspense } from "react";
import Footer from "../components/Footer";
import PremiumHeader from "../components/premium/PremiumHeader";
import { courseCatalog } from "../data/courseCatalog";
import { getUpcomingSchedulesWithState } from "../lib/public-content";
import HomeHero from "../components/home/HomeHero";
import CoreProgrammes from "../components/home/CoreProgrammes";
import CourseCatalogue from "../components/home/CourseCatalogue";
import UpcomingTraining, { UpcomingTrainingLoading } from "../components/home/UpcomingTraining";
import DeliveryOptions from "../components/home/DeliveryOptions";
import Recognition from "../components/home/Recognition";
import HomeFaq from "../components/home/HomeFaq";
import HomeContact from "../components/home/HomeContact";
import LegacyAnchors from "../components/home/LegacyAnchors";
import kit from "../components/premium/premium.module.css";

// Resolve schedule cards through the catalogue's stable CRM identity first.
// The RPC slug is a database value and may use the canonical CRM naming,
// while the public catalogue can intentionally use a different route slug.
const publicScheduleSlug = (session) => {
  const byCrmId = courseCatalog.find((course) => course.crmCourseId && course.crmCourseId === session.course_id);
  if (byCrmId) return byCrmId.slug;
  return courseCatalog.find((course) => course.slug === session.slug)?.slug ?? null;
};

// Same RPC calls and cache lifetime as before (at most three sessions, revalidated every 60 seconds); the cached result now also
// says whether the schedule request failed, so a failure shows the unavailable state instead of the empty one. courseSlug is resolved through the existing catalogue mapping and decides whether a course link exists.
async function UpcomingTrainingSection() {
  const { schedules, error } = await getUpcomingSchedulesWithState();
  const sessions = schedules.map((session) => ({ ...session, courseSlug: publicScheduleSlug(session) }));
  return <UpcomingTraining sessions={sessions} unavailable={error} />;
}

export default function HomePage() {
  return (
    <>
      <PremiumHeader />
      <main className={kit.px}>
        <LegacyAnchors />
        <HomeHero />
        <CoreProgrammes />
        <Suspense fallback={<UpcomingTrainingLoading />}>
          <UpcomingTrainingSection />
        </Suspense>
        <section id="courses" className={kit.sec} aria-labelledby="courses-title">
          <div className={kit.wrap}>
            <div className={kit.kicker}>
              <h2 id="courses-title">All courses</h2>
              <p>Every course, how long it runs and how it is delivered.</p>
            </div>
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
