import Image from "next/image";
import MobileNav from "../../components/MobileNav";
import MegaNav from "../../components/MegaNav";
import ContactEnquiryForm from "../../components/ContactEnquiryForm";
import Footer from "../../components/Footer";

const faqs = [
  ["Can training be customised?", "Yes. Programme scope can be discussed around participant profiles, operational risks, organisational procedures and desired learning outcomes."],
  ["Do you provide in-house training?", "Yes. Programmes can be arranged for a specific organisation, department, project team or workforce group."],
  ["Can you train at our site?", "Selected programmes may be delivered onsite, subject to programme requirements, site suitability, equipment availability and safety arrangements."],
  ["Do participants receive certificates?", "Certification or proof of completion depends on the programme structure, attendance, assessment requirements and applicable competency criteria."],
];
const reasons = [
  ["01", "Fast Response", "A clear starting point for discussing your training or consultancy requirements."],
  ["02", "Experienced Trainers", "Practical conversations shaped by industrial learning and competency development needs."],
  ["03", "Industry Solutions", "Support across industrial safety, technical competency, consultancy and workforce development."],
  ["04", "Nationwide Delivery", "Flexible arrangements for organisations operating across Malaysia."],
];

export default function ContactPage() {
  return (
    <main className="contact-page">
      <header className="site-header">
        <div className="container nav-wrap">
          <a className="brand" href="/" aria-label="TERAS UNIVERSAL home"><Image src="/teras-universal-logo.png" alt="TERAS UNIVERSAL logo" width={220} height={140} priority sizes="154px" /></a>
          <MegaNav />
          <MobileNav basePath="/" />
        </div>
      </header>

      <section className="contact-page-hero" aria-labelledby="contact-hero-title">
        <div className="container contact-page-hero-grid">
          <div className="contact-page-hero-copy"><span className="eyebrow">Contact TERAS UNIVERSAL</span><h1 id="contact-hero-title">Let&apos;s Build Capability Together</h1><p>Speak with our training consultants to discuss industrial safety training, competency development, consultancy or customised workforce programmes.</p><div className="hero-actions"><a className="btn btn-primary" href="/request-proposal">Request Proposal</a><a className="btn btn-outline" href="https://wa.me/60195193834" target="_blank" rel="noreferrer">WhatsApp Us</a></div></div>
          <figure className="contact-page-hero-media"><Image src="/images/temp-ai-corporate-scene-11.webp" alt="Industrial consultant discussing training requirements in a modern workplace." width={1200} height={800} priority sizes="(max-width: 920px) 100vw, 52vw" /></figure>
        </div>
      </section>

      <section className="contact-info-section" aria-label="Contact information">
        <div className="container contact-info-grid">
          <article><span className="contact-info-number">01</span><h2>General Enquiries</h2><dl><div><dt>Email</dt><dd><a href="mailto:training@terasuniversal.com.my">training@terasuniversal.com.my</a></dd></div><div><dt>Phone</dt><dd><a href="tel:+60195193834">+60 19-519 3834</a></dd></div></dl></article>
          <article><span className="contact-info-number">02</span><h2>Office Address</h2><address>Lot 1961<br />Jalan Tanah Merah<br />Kg Tanah Merah Dalam<br />06000 Jitra<br />Kedah<br />Malaysia</address></article>
          <article><span className="contact-info-number">03</span><h2>Business Hours</h2><dl><div><dt>Sunday-Friday</dt><dd>8:30 AM - 5:30 PM</dd></div><div><dt>Saturday</dt><dd>Closed</dd></div></dl></article>
        </div>
      </section>

      <section className="contact-form-section" id="contact-form" aria-labelledby="contact-form-title">
        <div className="container contact-form-layout"><div className="contact-form-intro"><span className="eyebrow">Start a Conversation</span><h2 id="contact-form-title">Tell us what your organisation needs.</h2><p>Share a few details and our team can begin the conversation around the right training or consultancy arrangement.</p></div><ContactEnquiryForm /></div>
      </section>

      <section className="contact-map-section" aria-labelledby="map-title"><div className="container"><div className="section-heading contact-map-heading"><span className="eyebrow">Find Us</span><h2 id="map-title">Connect with TERAS UNIVERSAL.</h2></div><div className="contact-map-card"><iframe title="TERAS UNIVERSAL office location" src="https://www.google.com/maps?q=Lot%201961%2C%20Jalan%20Tanah%20Merah%2C%20Kg%20Tanah%20Merah%20Dalam%2C%2006000%20Jitra%2C%20Kedah%2C%20Malaysia&output=embed" loading="lazy" referrerPolicy="no-referrer-when-downgrade" /></div></div></section>

      <section className="contact-reasons-section" aria-labelledby="reasons-title"><div className="container"><div className="section-heading"><span className="eyebrow">Why Contact TERAS</span><h2 id="reasons-title">A practical first step toward stronger capability.</h2></div><div className="contact-reasons-grid">{reasons.map(([number, title, text]) => <article key={title}><span>{number}</span><h3>{title}</h3><p>{text}</p></article>)}</div></div></section>

      <section className="contact-faq-section" aria-labelledby="contact-faq-title"><div className="container"><div className="section-heading"><span className="eyebrow">Frequently Asked Questions</span><h2 id="contact-faq-title">A few quick answers before we speak.</h2></div><div className="contact-faq-list">{faqs.map(([question, answer]) => <details key={question}><summary>{question}<span aria-hidden="true">+</span></summary><p>{answer}</p></details>)}</div></div></section>

      <section className="contact-page-cta"><div className="container"><div><span className="eyebrow">Corporate &amp; Custom Solutions</span><h2>Ready to Strengthen Your Workforce?</h2></div><div className="hero-actions"><a className="btn btn-light" href="/request-proposal">Request Proposal</a><a className="btn btn-gold" href="https://wa.me/60195193834" target="_blank" rel="noreferrer">WhatsApp</a></div></div></section>

      <Footer />
    </main>
  );
}
