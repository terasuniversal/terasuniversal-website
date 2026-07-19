import { metrics } from "../data/metrics";
import VerifiedEmptyState from "./VerifiedEmptyState";

export default function MetricsBlock() {
  if (!metrics.length) {
    return (
      <VerifiedEmptyState
        title="Verified figures will appear here"
        body="We publish performance figures only once they are confirmed and can be substantiated. This section will populate automatically as figures are verified."
      />
    );
  }
  return (
    <div className="metrics-grid">
      {metrics.map((metric) => (
        <article className="metric-card" key={metric.label}>
          <strong>{metric.value}</strong>
          <span>{metric.label}</span>
          {metric.note ? <small>{metric.note}</small> : null}
        </article>
      ))}
    </div>
  );
}
