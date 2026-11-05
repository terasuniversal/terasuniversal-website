import { faqItems } from "../../data/faq";
import styles from "./home.module.css";

// Four existing entries, shown word for word; every answer is visible, none is hidden behind a toggle.
const questions = [
  "Can you assist with HRD Corp claims?",
  "Do you provide practical training?",
  "Are programmes suitable for beginners?",
  "How can we request a quotation?",
];

export default function HomeFaq() {
  const entries = questions.map((question) => faqItems.find(([, q]) => q === question)).filter(Boolean);
  return (
    <section id="faq" className={styles.faq} aria-labelledby="faq-title">
      <div className={`${styles.band} ${styles.bandHead}`}><h2 id="faq-title" className={styles.h2Huge}>Questions</h2></div>
      {entries.map(([, question, answer]) => (
        <div className={styles.band} key={question}><h3 className={styles.bandQuestion}>{question}</h3><p>{answer}</p></div>
      ))}
    </section>
  );
}
