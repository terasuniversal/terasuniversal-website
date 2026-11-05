import ContactForm from "../ContactForm";
import NewsletterSignup from "../NewsletterSignup";
import kit from "../premium/premium.module.css";

// ContactForm and NewsletterSignup are the existing components, unchanged: same fields, consent
// wording, endpoints (/api/contact with sourcePage "homepage", /api/newsletter) and spam protection.
// This section is the closing navy field; the shared footer continues it without a seam.
export default function HomeContact() {
  return (
    <section id="contact" className={`${kit.px} ${kit.close}`} aria-labelledby="contact-title">
      <div className={kit.wrap}>
        <div className={kit.cWrap}>
          <div>
            <h2 id="contact-title">Request a proposal</h2>
            <p className={kit.say}>Tell us the course, the headcount and where you want it run.</p>
            <div className={kit.direct}>
              <a className={kit.btn} href="/request-proposal">Start a full proposal request <span aria-hidden="true">&rarr;</span></a>
              <div>
                <small>WhatsApp</small>
                <a href="https://wa.me/60195193834" target="_blank" rel="noreferrer">019-519 3834<span className="sr-only"> (opens in a new tab)</span></a>
              </div>
              <div>
                <small>Email</small>
                <a href="mailto:training@terasuniversal.com.my">training@terasuniversal.com.my</a>
              </div>
              <div>
                <small>Centre</small>
                <p>Lot 1961, Jalan Tanah Merah, Kg Tanah Merah Dalam, 06000 Jitra, Kedah. Sunday to Friday, 8:30 am to 5:30 pm.</p>
              </div>
            </div>
          </div>
          <div className={kit.formSlot}>
            <ContactForm />
          </div>
        </div>
        <div id="newsletter" className={kit.news}>
          <h3 id="newsletter-title">Training Updates &amp; Industry Insights</h3>
          <div className={kit.newsSlot}>
            <NewsletterSignup />
          </div>
        </div>
      </div>
    </section>
  );
}
