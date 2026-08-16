"use client";

import { useState } from "react";

const NEUTRAL_ERROR = "We couldn't match these details to an eligible participant for this training session.";

export function ScheduleFeedbackLookupForm({ publicToken }: { publicToken: string }) {
  const [identityNumber, setIdentityNumber] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "error">("idle");
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === "sending") return;
    setStatus("sending");
    setError("");
    try {
      const response = await fetch("/api/feedback/schedule/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ publicToken, identityNumber }),
      });
      const result = await response.json().catch(() => null) as { redirectTo?: string } | null;
      if (!response.ok || !result?.redirectTo) throw new Error("unmatched");
      window.location.assign(result.redirectTo);
    } catch {
      setStatus("error");
      setError(NEUTRAL_ERROR);
    }
  }

  return (
    <form className="feedback-form" onSubmit={submit} noValidate>
      <div className="feedback-block">
        <label className="feedback-label" htmlFor="identity-number">IC / Passport Number</label>
        <input
          id="identity-number"
          className="feedback-input"
          type="text"
          autoComplete="off"
          inputMode="text"
          maxLength={120}
          value={identityNumber}
          onChange={(event) => setIdentityNumber(event.target.value)}
          required
        />
      </div>
      {error && <p className="feedback-error" role="alert">{error}</p>}
      <button className="feedback-submit" type="submit" disabled={status === "sending"}>
        {status === "sending" ? "Checking…" : "Continue"}
      </button>
      <p className="feedback-privacy">Your details are used only to find your feedback form for this training session.</p>
    </form>
  );
}
