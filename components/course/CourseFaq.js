import { faqItems } from "../../data/faq";
import { courseContent } from "../../content/en/course";
import styles from "./course.module.css";

// FT-1A-2 (owner-approved): published FAQ answers on the course page. The wording is read from data/faq.js (pinned by
// the R2 S2-0 contract) and selected by exact question, so no answer is written or edited here. Layout classes for the
// section come from the page, which owns the Premium kit; this component does not import it.
export default function CourseFaq({ sectionClass, wrapClass }) {
  const text = courseContent.faq;
  const items = text.questions.map((question) => faqItems.find(([, published]) => published === question)).filter(Boolean);
  if (items.length === 0) return null;
  return (
    <section className={sectionClass} aria-labelledby="course-faq-title">
      <div className={wrapClass}>
        <p className={styles.eyebrow}>{text.eyebrow}</p>
        <h2 id="course-faq-title">{text.title}</h2>
        <div className={styles.faq}>
          {items.map(([, question, answer]) => (
            <details className={styles.faqItem} key={question}>
              <summary>{question}</summary>
              <p>{answer}</p>
            </details>
          ))}
        </div>
        <a className={styles.faqAll} href="/faq">{text.all}</a>
      </div>
    </section>
  );
}
