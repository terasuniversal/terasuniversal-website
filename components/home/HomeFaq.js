import { faqItems } from "../../data/faq";
import kit from "../premium/premium.module.css";

// Four existing entries, shown word for word. The first answer opens by default; every answer stays in the page.
const questions = [
  "Can you assist with HRD Corp claims?",
  "Do you provide practical training?",
  "Are programmes suitable for beginners?",
  "How can we request a quotation?",
];

export default function HomeFaq() {
  const entries = questions.map((question) => faqItems.find(([, q]) => q === question)).filter(Boolean);
  return (
    <section id="faq" className={kit.sec} aria-labelledby="faq-title">
      <div className={`${kit.wrap} ${kit.faq}`}>
        <h2 id="faq-title">Questions</h2>
        <div>
          {entries.map(([, question, answer], index) => (
            <details className={kit.q} key={question} open={index === 0}>
              <summary>{question}</summary>
              <p>{answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
