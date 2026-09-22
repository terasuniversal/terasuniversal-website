"use client";

import Link from "next/link";

export function ParticipantResultActions({ assessmentHref }: { assessmentHref: string }) {
  return (
    <div className="ta-participant-result-actions" aria-label="Participant Result actions">
      <Link className="ta-btn ta-btn-outline" href={assessmentHref}>
        ← Back to Assessment
      </Link>
      <button className="ta-btn ta-btn-primary" type="button" onClick={() => window.print()}>
        Print / Save PDF
      </button>
    </div>
  );
}