import { timeline } from "../data/timeline";

export default function CorporateTimeline() {
  if (!timeline.length) return null;
  return (
    <ol className="corporate-timeline">
      {timeline.map((milestone) => (
        <li key={`${milestone.year}-${milestone.title}`}>
          <span className="timeline-year">{milestone.year}</span>
          <div><h3>{milestone.title}</h3><p>{milestone.description}</p></div>
        </li>
      ))}
    </ol>
  );
}
