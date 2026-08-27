const facts = [["Duration", "duration"], ["Delivery", "deliveryMode"], ["Assessment", "assessment"], ["Completion", "completion"]];

export default function CourseFactList({ course }) {
  const visibleFacts = facts.filter(([, key]) => Boolean(course[key]) && !String(course[key]).toLowerCase().includes("to be confirmed"));
  if (!visibleFacts.length) return null;
  return <div className="course-info-grid">{visibleFacts.map(([label, key]) => <article key={key}><strong>{label}</strong><span>{course[key]}</span></article>)}</div>;
}
