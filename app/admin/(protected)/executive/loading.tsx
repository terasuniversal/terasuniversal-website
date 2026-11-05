export default function Loading() {
  return (
    <div className="ta-ops-loading" aria-label="Loading CEO Dashboard" role="status">
      <div className="ta-ops-loading-summary">{[1, 2, 3, 4].map((item) => <div className="ta-ops-skeleton ta-ops-skeleton-card" key={item} />)}</div>
      <div className="ta-ops-skeleton ta-ops-skeleton-panel" />
    </div>
  );
}
