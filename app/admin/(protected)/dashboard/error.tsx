"use client";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="ta-ops-error" role="alert">
      <strong>Unable to load Training Operations data</strong>
      <p>Refresh the dashboard or try again. No operational counts are shown when a required data source fails.</p>
      <button className="ta-btn ta-btn-primary" type="button" onClick={() => reset()}>Try again</button>
    </div>
  );
}
