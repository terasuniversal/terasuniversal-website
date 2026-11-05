"use client";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="ta-ops-error" role="alert">
      <strong>Unable to load registrations</strong>
      <p>No registration data is shown when a required data source fails. Refresh or try again.</p>
      <button className="ta-btn ta-btn-primary" type="button" onClick={() => reset()}>Try again</button>
    </div>
  );
}
