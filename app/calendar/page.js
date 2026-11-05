import Footer from "../../components/Footer";
import PremiumHeader from "../../components/premium/PremiumHeader";
import TrainingCalendar from "../../components/TrainingCalendar";
import LeadGenCta from "../../components/LeadGenCta";
import { getPublishedSchedulesWithState } from "../../lib/public-content";

export const metadata = { title: "Training Calendar", description: "Browse TERAS UNIVERSAL training programme dates and delivery options in Malaysia.", alternates: { canonical: "/calendar" } };

export default async function CalendarPage({ searchParams }) {
  const { schedules: sessions, error: scheduleLoadError } = await getPublishedSchedulesWithState();
  const { course, courseId } = await searchParams;
  return <>
      <PremiumHeader />
      <main className="utility-page"><div className="container utility-container"><span className="eyebrow">Programme Schedule</span><h1>Training Calendar</h1><p className="utility-lead">Browse public sessions arranged through the TERAS training schedule. Where a session is open and priced, you can register online; otherwise, enquire about the next suitable date.</p><TrainingCalendar sessions={sessions} loadError={scheduleLoadError} courseSlug={typeof course === "string" ? course : undefined} courseId={typeof courseId === "string" ? courseId : undefined} /><LeadGenCta title="Don't see a suitable date?" text="We also arrange in-house and customised training windows. Let us know your preferred timing and we'll propose a plan." /></div>
      </main>
      <Footer />
    </>;
}
