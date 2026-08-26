import Image from "next/image";
import { enquiryHref } from "./PrimaryCtaGroup";
import styles from "./public-phase-one.module.css";

export default function CourseCard({ course, source = "training-page" }) {
  const href = course ? `/training/${course.slug}` : enquiryHref({ source });
  const cta = course ? "View Course" : "Enquire About Training";

  return <article className={`training-programme-card ${styles.courseCard}`}>
    {course?.image && <div className="training-programme-media"><Image src={course.image} alt={`${course.title} training visual.`} width={900} height={506} sizes="(max-width: 590px) 100vw, (max-width: 920px) 50vw, 25vw" /></div>}
    <div className="training-programme-content">
      <span className="training-card-category">{course?.category ?? "Custom solution"}</span>
      <h3>{course?.title ?? "Custom Corporate Training"}</h3>
      <p>{course?.summary ?? "Tell us about your workforce, site requirements and intended outcomes, and our team will propose a suitable arrangement."}</p>
      {course?.audience?.length > 0 && <p className="training-card-audience"><strong>Suitable for</strong>{course.audience.slice(0, 3).join(", ")}</p>}
      <a className={`training-card-link ${styles.courseLink}`} href={href}>{cta} <span aria-hidden="true">&rarr;</span></a>
    </div>
  </article>;
}
