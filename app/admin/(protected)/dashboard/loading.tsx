export default function Loading() {
  return (
    <div className="ta-ops-loading" aria-label="Loading Training Operations dashboard" role="status">
      <div className="ta-ops-loading-summary">{[1, 2, 3, 4].map((item) => <div className="ta-ops-skeleton ta-ops-skeleton-card" key={item} />)}</div>
      <div className="ta-ops-skeleton ta-ops-skeleton-panel" />
      <div className="ta-ops-loading-grid">{[1, 2, 3].map((item) => <div className="ta-ops-skeleton ta-ops-skeleton-panel" key={item} />)}</div>
    </div>
  );
}
