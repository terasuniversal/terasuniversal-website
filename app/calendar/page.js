import Image from "next/image";
import MobileNav from "../../components/MobileNav";
import MegaNav from "../../components/MegaNav";
import Footer from "../../components/Footer";
import TrainingCalendar from "../../components/TrainingCalendar";
import LeadGenCta from "../../components/LeadGenCta";
import { getPublishedSchedulesWithState } from "../../lib/public-content";

export const metadata = { title: "Training Calendar", description: "Browse TERAS UNIVERSAL training programme dates and delivery options in Malaysia.", alternates: { canonical: "/calendar" } };

export default async function CalendarPage({ searchParams }) {
  const { schedules: sessions, error: scheduleLoadError } = await getPublishedSchedulesWithState();
  const { course, courseId } = await searchParams;
  return <main className="utility-page"><header className="site-header"><div className="container nav-wrap"><a className="brand" href="/" aria-label="TERAS UNIVERSAL home"><Image src="/teras-universal-logo.png" alt="TERAS UNIVERSAL logo" width={220} height={140} priority sizes="154px" /></a><MegaNav /><MobileNav basePath="/" /></div></header><div className="container utility-container"><span className="eyebrow">Programme Schedule</span><h1>Training Calendar</h1><p className="utility-lead">Browse public sessions arranged through the TERAS training schedule. Where a session is open and priced, you can register online; otherwise, enquire about the next suitable date.</p><TrainingCalendar sessions={sessions} loadError={scheduleLoadError} courseSlug={typeof course === "string" ? course : undefined} courseId={typeof courseId === "string" ? courseId : undefined} /><LeadGenCta title="Don't see a suitable date?" text="We also arrange in-house and customised training windows. Let us know your preferred timing and we'll propose a plan." /></div><Footer /></main>;
}
