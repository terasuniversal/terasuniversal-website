import { courseCatalog } from "../../data/courseCatalog";
import styles from "./home.module.css";

const bySlug = (slug) => courseCatalog.find((course) => course.slug === slug);

const groups = [
  { label: "Scaffolding Erector", slugs: ["basic-scaffolder-level-1", "intermediate-scaffolder-level-2", "advanced-scaffolder-level-3"] },
  { label: "Scaffolding Inspector", slugs: ["scaffolding-inspector-basic", "scaffolding-inspector-intermediate", "scaffolding-inspector-advanced"] },
  { label: "Industrial safety", slugs: ["working-at-height", "confined-space-safety", "safety-passport", "lifting-awareness"] },
];

// Only approved values are shown; anything the catalogue has not confirmed says so instead of guessing.
const lengthText = (course) => (/to be confirmed/i.test(course.duration) ? "Confirmed with scope" : course.duration);
const deliveryText = (course) => course.deliveryMode ?? "Confirmed with scope";

// Explicit roles keep the table semantics when the rows stack on small screens.
export default function CourseTable() {
  return (
    <table className={styles.table} role="table">
      <thead role="rowgroup">
        <tr role="row"><th role="columnheader">Course</th><th role="columnheader">Length</th><th role="columnheader">Delivery</th></tr>
      </thead>
      <tbody role="rowgroup">
        {groups.flatMap((group) => [
          <tr role="row" className={styles.group} key={group.label}><td role="cell" colSpan={3}>{group.label}</td></tr>,
          ...group.slugs.map(bySlug).filter(Boolean).map((course) => (
            <tr role="row" key={course.slug}>
              <td role="cell"><a className={styles.tableLink} href={`/training/${course.slug}`}>{course.title}</a></td>
              <td role="cell" data-label="Length: ">{lengthText(course)}</td>
              <td role="cell" data-label="Delivery: ">{deliveryText(course)}</td>
            </tr>
          )),
        ])}
      </tbody>
    </table>
  );
}
