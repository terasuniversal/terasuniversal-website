"use client";

import { useMemo, useState } from "react";
import { enquiryHref } from "../public/PrimaryCtaGroup";
import { trainingContent } from "../../content/en/training";
import kit from "../premium/premium.module.css";
import TrainingCourseCard from "./TrainingCourseCard";
import styles from "./training.module.css";

// Hybrid Premium V2 course catalogue (/training, Phase S4C). The category filter and the card list are the ones /training
// had before S4C (same categories, same order, same count line, same custom-training card); only the presentation changed.
// Cards come from data/courseCatalog.js via the page; the duration is shown only when the catalogue states it in days
// (lib/course-session-map.ts, the rule the homepage and calendar use). Each title links to the course's own detail page.
// Since S4C-1 the card itself is components/training/TrainingCourseCard.js, shared with the scaffolding category page.
export default function CourseCatalogue({ courses }) {
  const text = trainingContent.catalogue;
  const categories = useMemo(() => [text.allCategories, ...new Set(courses.map((course) => course.category))], [courses, text.allCategories]);
  const [activeCategory, setActiveCategory] = useState(text.allCategories);
  const visibleCourses = useMemo(() => (activeCategory === text.allCategories ? courses : courses.filter((course) => course.category === activeCategory)), [activeCategory, courses, text.allCategories]);

  return (
    <section id="course-catalogue" className={`${kit.px} ${kit.sec} ${kit.tone} ${styles.catalogue}`} aria-labelledby="programme-title">
      <div className={kit.wrap}>
        <p className={styles.eyebrow}>{text.eyebrow}</p>
        <h2 id="programme-title">{text.title}</h2>
        <p className={styles.sectionText}>{text.text}</p>
        <div className={styles.filters} role="group" aria-label={text.filterLabel}>
          {categories.map((category) => (
            <button key={category} type="button" className={activeCategory === category ? styles.filterOn : ""} aria-pressed={activeCategory === category} onClick={() => setActiveCategory(category)}>{category}</button>
          ))}
        </div>
        <p className={styles.count} aria-live="polite"><strong>{text.count(visibleCourses.length)}</strong></p>
        <ul className={styles.cards}>
          {visibleCourses.map((course) => <TrainingCourseCard key={course.slug} course={course} />)}
          <li className={`${styles.card} ${styles.customCard}`}>
            <div className={styles.body}>
              <p className={styles.category}>{text.custom.category}</p>
              <h3><a className={styles.cardLink} href={enquiryHref({ source: text.custom.source })}>{text.custom.title}</a></h3>
              <p className={styles.summary}>{text.custom.summary}</p>
              <span className={styles.more} aria-hidden="true">{text.custom.more}</span>
            </div>
          </li>
        </ul>
      </div>
    </section>
  );
}
