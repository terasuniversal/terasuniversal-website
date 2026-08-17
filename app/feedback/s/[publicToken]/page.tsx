import { ScheduleFeedbackLookupForm } from "./ScheduleFeedbackLookupForm";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Training Feedback | TERAS UNIVERSAL",
  robots: { index: false, follow: false },
};

export default async function ScheduleFeedbackEntryPage({ params }: { params: Promise<{ publicToken: string }> }) {
  const { publicToken } = await params;
  return (
    <main className="feedback-page">
      <div className="feedback-shell">
        <img className="feedback-logo" src="/teras-universal-logo.png" alt="TERAS UNIVERSAL" />
        <header className="feedback-head">
          <span className="feedback-eyebrow">Training Feedback</span>
          <h1>Participant Feedback</h1>
          <p className="feedback-intro">Enter your IC or passport number to open your feedback form for this training session.</p>
        </header>
        <ScheduleFeedbackLookupForm publicToken={publicToken} />
      </div>
    </main>
  );
}
