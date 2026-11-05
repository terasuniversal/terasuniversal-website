import ContactForm from "../ContactForm";
import NewsletterSignup from "../NewsletterSignup";
import styles from "./home.module.css";

// ContactForm and NewsletterSignup are the existing components, unchanged: same fields, consent
// wording, endpoints (/api/contact with sourcePage "homepage", /api/newsletter) and spam protection.
export default function HomeContact() {
  return (
    <section id="contact" className={styles.contact} aria-labelledby="contact-title">
      <div className={styles.cLeft}>
        <h2 id="contact-title" className={styles.h2}>Request a proposal</h2>
        <p className={styles.say}>Tell us the course, the headcount and where you want it run.</p>
        <div className={styles.reach}>
          <a href="/request-proposal">Start a full proposal request</a>
          <a href="https://wa.me/60195193834" target="_blank" rel="noreferrer">WhatsApp 019-519 3834<span className="sr-only"> (opens in a new tab)</span></a>
          <a href="mailto:training@terasuniversal.com.my">training@terasuniversal.com.my</a>
          <small>Lot 1961, Jalan Tanah Merah, Kg Tanah Merah Dalam, 06000 Jitra, Kedah. Sunday to Friday, 8:30 am to 5:30 pm.</small>
        </div>
      </div>
      <div className={styles.formSlot}>
        <ContactForm />
      </div>
      <div id="newsletter" className={styles.news}>
        <h3 id="newsletter-title" className={styles.h3}>Training Updates &amp; Industry Insights</h3>
        <div className={styles.newsSlot}>
          <NewsletterSignup />
        </div>
      </div>
    </section>
  );
}
