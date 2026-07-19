import TrainingCalendar from "../../components/TrainingCalendar";

export const metadata = { title: "Training Calendar", description: "Browse TERAS UNIVERSAL training programme dates and delivery options in Malaysia.", alternates: { canonical: "/calendar" } };

export default function CalendarPage() {
  return <main className="utility-page"><div className="container utility-container"><span className="eyebrow">Programme Schedule</span><h1>Training Calendar</h1><p className="utility-lead">Explore upcoming public programmes and contact our team to reserve a suitable training window for your organisation.</p><TrainingCalendar /></div></main>;
}
