import { courseCatalog } from "../../data/courseCatalog";
import kit from "../premium/premium.module.css";

const bySlug = (slug) => courseCatalog.find((course) => course.slug === slug);

const groups = [
  { label: "Scaffolding Erector", slugs: ["basic-scaffolder-level-1", "intermediate-scaffolder-level-2", "advanced-scaffolder-level-3"] },
  { label: "Scaffolding Inspector", slugs: ["scaffolding-inspector-basic", "scaffolding-inspector-intermediate", "scaffolding-inspector-advanced"] },
  { label: "Industrial safety", slugs: ["working-at-height", "confined-space-safety", "safety-passport", "lifting-awareness"] },
];

// Only approved values are shown; anything the catalogue has not confirmed says so instead of guessing.
const lengthText = (course) => (/to be confirmed/i.test(course.duration) ? "Confirmed with scope" : course.duration);
const deliveryText = (course) => course.deliveryMode ?? "Confirmed with scope";

// Every course keeps its length and delivery. When a whole group shares one delivery value it is stated once
// under the group name; otherwise each course shows its own.
export default function CourseCatalogue() {
  return (
    <div className={kit.cat}>
      {groups.map((group) => {
        const courses = group.slugs.map(bySlug).filter(Boolean);
        const deliveries = [...new Set(courses.map(deliveryText))];
        const shared = deliveries.length === 1 ? deliveries[0] : null;
        return (
          <section className={kit.cg} key={group.label} aria-label={group.label}>
            <h3>{group.label}</h3>
            {shared && <p className={kit.cgNote}>Delivery: {shared}</p>}
            {courses.map((course) => (
              <a href={`/training/${course.slug}`} key={course.slug}>
                <span className={kit.cgName}>{course.title}{!shared && <small>Delivery: {deliveryText(course)}</small>}</span>
                <span>{lengthText(course)}</span>
              </a>
            ))}
          </section>
        );
      })}
    </div>
  );
}
