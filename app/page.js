import Image from "next/image";
import ContactForm from "../components/ContactForm";

const courses = [
  ["01", "Working at Height", "Practical awareness training, safe work procedures and essential controls for work at height."],
  ["02", "Scaffolding", "Introduction, erection fundamentals, inspection practices and safe scaffolding operations."],
  ["03", "Safety Awareness", "Hazard identification, risk control and workplace safety culture development."],
  ["04", "Custom Corporate Training", "Tailored programmes designed around your organisation, project and workforce requirements."],
];

export default function HomePage() {
  return (
    <main>
      <header className="site-header">
        <div className="container nav-wrap">
          <a className="brand" href="#home" aria-label="TERAS UNIVERSAL home">
            <Image src="/teras-universal-logo.png" alt="TERAS UNIVERSAL logo" width={170} height={110} priority />
          </a>
          <nav aria-label="Main navigation">
            <a href="#about">About</a>
            <a href="#training">Training</a>
            <a href="#why">Why Us</a>
            <a href="#contact">Contact</a>
            <a className="nav-cta" href="https://wa.me/60195193834" target="_blank" rel="noreferrer">WhatsApp</a>
          </nav>
        </div>
      </header>

      <section className="hero" id="home">
        <div className="container hero-grid">
          <div className="hero-copy">
            <span className="eyebrow">TERAS UNIVERSAL SDN. BHD. · 976732-P</span>
            <h1>Building Competence.<br/><span>Creating Opportunities.</span></h1>
            <p className="hero-lead">
              Professional industrial safety training and consultancy for individuals,
              organisations and industry partners across Malaysia.
            </p>
            <div className="hero-actions">
              <a className="btn btn-primary" href="#contact">Request Training Information</a>
              <a className="btn btn-outline" href="https://wa.me/60195193834?text=Hello%20TERAS%20UNIVERSAL%2C%20I%20would%20like%20to%20enquire%20about%20your%20training%20programmes." target="_blank" rel="noreferrer">WhatsApp Our Team</a>
            </div>
            <div className="trust-row">
              <span>Industry-focused</span><span>Practical learning</span><span>Custom programmes</span>
            </div>
          </div>
          <div className="hero-visual">
            <div className="logo-stage">
              <Image src="/teras-universal-logo.png" alt="TERAS UNIVERSAL" width={620} height={400} priority />
            </div>
            <div className="hero-metrics">
              <div><strong>Theory</strong><span>Strong foundations</span></div>
              <div><strong>Practical</strong><span>Hands-on learning</span></div>
              <div><strong>Industry</strong><span>Workplace relevance</span></div>
            </div>
          </div>
        </div>
      </section>

      <section id="about">
        <div className="container">
          <div className="section-heading">
            <span className="eyebrow">About TERAS</span>
            <h2>Training that builds capability, discipline and confidence.</h2>
            <p>We develop practical learning experiences tailored to workforce needs, operational objectives and real industry expectations.</p>
          </div>
          <div className="service-grid">
            <article><span>01</span><h3>Industrial Safety</h3><p>Programmes focused on safe work culture, compliance and operational readiness.</p></article>
            <article><span>02</span><h3>Skills Development</h3><p>Theory and practical learning designed to strengthen workplace competence.</p></article>
            <article><span>03</span><h3>Corporate Programmes</h3><p>Custom training aligned with organisational goals and project requirements.</p></article>
            <article><span>04</span><h3>Consultancy</h3><p>Support for programme planning, coordination and implementation.</p></article>
          </div>
        </div>
      </section>

      <section id="training" className="soft-section">
        <div className="container">
          <div className="section-heading">
            <span className="eyebrow">Training Areas</span>
            <h2>Programmes tailored to your operational needs.</h2>
            <p>Content and duration can be customised according to objectives, participant profiles and workplace requirements.</p>
          </div>
          <div className="course-grid">
            {courses.map(([number, title, text]) => (
              <article key={title}><span>{number}</span><h3>{title}</h3><p>{text}</p><a href="#contact">Enquire now →</a></article>
            ))}
          </div>
        </div>
      </section>

      <section id="why">
        <div className="container why-grid">
          <div>
            <span className="eyebrow">Why TERAS UNIVERSAL</span>
            <h2>Structured learning built around industry expectations.</h2>
            <div className="check-list">
              {["Balanced theory and practical learning","Industry-oriented training modules","Customisable programme structure","End-to-end coordination support"].map(item => (
                <div key={item}><b>✓</b><span>{item}</span></div>
              ))}
            </div>
          </div>
          <aside className="consult-panel">
            <span>Corporate Training</span>
            <h3>Need a customised programme?</h3>
            <p>Share your objective, preferred date and number of participants. Our team will prepare a suitable proposal.</p>
            <a className="btn btn-light" href="#contact">Discuss Your Requirements</a>
          </aside>
        </div>
      </section>

      <section id="contact" className="contact-section">
        <div className="container">
          <div className="section-heading">
            <span className="eyebrow">Contact Us</span>
            <h2>Let us discuss your training requirements.</h2>
          </div>
          <div className="contact-layout">
            <ContactForm />
            <div className="contact-details">
              <div className="detail-card">
                <h3>TERAS UNIVERSAL SDN. BHD.</h3>
                <p>Industrial Safety Training & Consultancy</p>
                <dl>
                  <div><dt>Phone</dt><dd><a href="tel:+60195193834">+60 19-519 3834</a></dd></div>
                  <div><dt>Administration</dt><dd><a href="mailto:admin@terasuniversal.com.my">admin@terasuniversal.com.my</a></dd></div>
                  <div><dt>Training</dt><dd><a href="mailto:training@terasuniversal.com.my">training@terasuniversal.com.my</a></dd></div>
                  <div><dt>Address</dt><dd>Lot 1961, Jalan Tanah Merah, Kg Tanah Merah Dalam, 06000 Jitra, Kedah, Malaysia</dd></div>
                </dl>
              </div>
              <div className="map-card">
                <iframe
                  title="TERAS UNIVERSAL location"
                  src="https://www.google.com/maps?q=Lot%201961%2C%20Jalan%20Tanah%20Merah%2C%20Kg%20Tanah%20Merah%20Dalam%2C%2006000%20Jitra%2C%20Kedah%2C%20Malaysia&output=embed"
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      <a className="floating-whatsapp" href="https://wa.me/60195193834?text=Hello%20TERAS%20UNIVERSAL%2C%20I%20would%20like%20to%20enquire%20about%20your%20training%20programmes." target="_blank" rel="noreferrer" aria-label="Contact TERAS UNIVERSAL on WhatsApp">WA</a>

      <footer>
        <div className="container footer-grid">
          <div className="footer-brand">
            <Image src="/teras-universal-logo.png" alt="TERAS UNIVERSAL" width={190} height={125} />
            <p>Building Competence.<br/>Creating Opportunities.</p>
          </div>
          <div><h3>Company</h3><p>TERAS UNIVERSAL SDN. BHD.<br/>(976732-P)</p><p>Industrial Safety Training & Consultancy</p></div>
          <div><h3>Contact</h3><p><a href="mailto:training@terasuniversal.com.my">training@terasuniversal.com.my</a><br/><a href="tel:+60195193834">+60 19-519 3834</a></p><p>Lot 1961, Jalan Tanah Merah,<br/>Kg Tanah Merah Dalam,<br/>06000 Jitra, Kedah, Malaysia</p></div>
        </div>
        <div className="container footer-bottom"><span>© 2026 TERAS UNIVERSAL SDN. BHD. All rights reserved.</span><span>terasuniversal.com.my</span></div>
      </footer>
    </main>
  );
}
