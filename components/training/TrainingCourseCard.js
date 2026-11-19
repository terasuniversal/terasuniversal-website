import Image from "next/image";
import { trainingContent } from "../../content/en/training";
import { catalogueDurationText } from "../../lib/course-session-map";
import styles from "./training.module.css";

// One catalogue course as a Premium V2 card (Phase S4C-1, extracted unchanged from components/training/CourseCatalogue.js
// so /training and /training/scaffolding-competency show the same card). Every value is the catalogue entry's own:
// category, title, summary, duration (only when stated in days, lib/course-session-map.ts) and audience. The title links
// to the course's existing detail route and its ::after covers the card, so the card is one target named by the title.
export default function TrainingCourseCard({ course }) {
  const text = trainingContent.catalogue;
  const duration = catalogueDurationText(course);
  return (
    <li className={styles.card}>
      {course.image && <div className={styles.media} aria-hidden="true"><Image src={course.image} alt="" unoptimized width={900} height={506} sizes="(max-width: 599px) 100vw, (max-width: 960px) 50vw, 33vw" /></div>}
      <div className={styles.body}>
        <p className={styles.category}>{course.category}</p>
        <h3><a className={styles.cardLink} href={`/training/${course.slug}`}>{course.title}</a></h3>
        <p className={styles.summary}>{course.summary}</p>
        {duration && <p className={styles.meta}><span>{text.duration}</span> {duration}</p>}
        {course.audience?.length > 0 && <p className={styles.meta}><span>{text.audience}</span> {course.audience.slice(0, 3).join(", ")}</p>}
        <span className={styles.more} aria-hidden="true">{text.more}</span>
      </div>
    </li>
  );
}
