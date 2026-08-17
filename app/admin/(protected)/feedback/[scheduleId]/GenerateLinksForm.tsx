"use client";

import { useActionState } from "react";
import { generateFeedbackLinks, type FeedbackLinkActionState } from "../actions";

const INITIAL: FeedbackLinkActionState = { ok: true };

export function GenerateLinksForm({ scheduleId }: { scheduleId: string }) {
  const [state, action, pending] = useActionState(generateFeedbackLinks.bind(null, scheduleId), INITIAL);

  return (
    <form action={action}>
      {state.message && (
        <div className={`ta-alert ${state.ok ? "ta-alert-success" : "ta-alert-error"}`} style={{ marginBottom: 10 }} role="status">
          {state.message}
        </div>
      )}
      <button type="submit" className="ta-btn ta-btn-primary" disabled={pending} style={{ width: "100%" }}>
        {pending ? "Generating…" : "Generate Feedback Links"}
      </button>
    </form>
  );
}
