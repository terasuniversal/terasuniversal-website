import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { FeedbackForm } from "./FeedbackForm";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Training Feedback | TERAS UNIVERSAL",
  description: "Share your feedback on your TERAS UNIVERSAL training programme.",
  robots: { index: false, follow: false },
};

interface FeedbackContext {
  valid: boolean;
  already_submitted: boolean;
  course_title: string | null;
  schedule_code: string | null;
  schedule_start: string | null;
  schedule_end: string | null;
  venue: string | null;
  trainer_name: string | null;
}

export default async function FeedbackPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("feedback_get_by_token", { p_token: token });

  // Invalid/expired link — never surface DB internals.
  if (error || !data || data.length === 0) {
    return (
      <main className="feedback-page">
        <div className="feedback-shell">
          <img className="feedback-logo" src="/teras-universal-logo.png" alt="TERAS UNIVERSAL" />
          <div className="feedback-state">
            <h1>Feedback Link Unavailable</h1>
            <p>This feedback link is invalid or has expired. Please contact TERAS UNIVERSAL for assistance.</p>
          </div>
        </div>
      </main>
    );
  }

  const ctx = data[0] as FeedbackContext;

  if (ctx.already_submitted) {
    return (
      <main className="feedback-page">
        <div className="feedback-shell">
          <img className="feedback-logo" src="/teras-universal-logo.png" alt="TERAS UNIVERSAL" />
          <div className="feedback-state">
            <h1>Thank You</h1>
            <p>Your feedback has already been submitted. Your feedback helps TERAS improve the quality of our training and services.</p>
          </div>
        </div>
      </main>
    );
  }

  const dateLabel = (d: string | null) =>
    d ? new Date(`${d}T00:00:00`).toLocaleDateString("en-MY", { day: "numeric", month: "long", year: "numeric" }) : "—";

  return (
    <main className="feedback-page">
      <div className="feedback-shell">
        <img className="feedback-logo" src="/teras-universal-logo.png" alt="TERAS UNIVERSAL" />
        <header className="feedback-head">
          <span className="feedback-eyebrow">Training Feedback</span>
          <h1>{ctx.course_title ?? "Training Programme"}</h1>
          {ctx.schedule_code && <p className="feedback-ref">{ctx.schedule_code}</p>}
          <p className="feedback-meta">
            {dateLabel(ctx.schedule_start)}
            {ctx.schedule_end && ctx.schedule_end !== ctx.schedule_start ? ` – ${dateLabel(ctx.schedule_end)}` : ""}
            {ctx.venue ? ` · ${ctx.venue}` : ""}
          </p>
          {ctx.trainer_name && <p className="feedback-meta">Trainer: {ctx.trainer_name}</p>}
          <p className="feedback-intro">
            Thank you for training with TERAS UNIVERSAL. Your honest feedback helps us improve the quality of our
            training and services. Your responses are anonymous to trainers.
          </p>
        </header>

        <FeedbackForm token={token} />
      </div>
    </main>
  );
}
