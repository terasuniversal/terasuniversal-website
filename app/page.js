import Image from "next/image";
import ContactForm from "../components/ContactForm";
import MobileNav from "../components/MobileNav";

const programmes = [
  ["01", "Scaffolding", "Core scaffolding knowledge, safe erection practices and inspection awareness."],
  ["02", "Working at Height", "Safe access, fall prevention and practical control measures for elevated work."],
  ["03", "Safety Awareness", "Hazard identification, risk controls and workplace safety responsibilities."],
  ["04", "Confined Space Awareness", "Fundamental awareness of confined-space hazards and safe entry principles."],
  ["05", "Rigger & Signalman Awareness", "Basic communication, signalling and lifting-operation safety awareness."],
  ["06", "Forklift Safety", "Safe forklift operation awareness, workplace controls and daily inspection principles."],
  ["07", "Emergency Response", "Preparedness, communication and response awareness for workplace emergencies."],
  ["08", "Custom Corporate Training", "Tailored programmes aligned with your workforce, project and operational goals."],
];

const approach = [
  ["Understand", "We begin by understanding your workforce, site conditions and training objectives."],
  ["Design", "We structure a suitable programme with clear outcomes, practical relevance and appropriate duration."],
  ["Deliver", "Training is delivered through a balanced combination of explanation, demonstration and participation."],
  ["Support", "We provide coordination support before, during and after the programme."],
];

export default function HomePage() {
  return (
    <main>
      <header className="site-header">
        <div className="container nav-wrap">
          <a className="brand" href="#home" aria-label="TERAS UNIVERSAL home">
            <Image
              src="/teras-universal-logo.png"
              alt="TERAS UNIVERSAL logo"
              width={220}
              height={140}
              priority
            />
          </a>

          <nav className="desktop-nav" aria-label="Main navigation">
            <a href="#about">About</a>
            <a href="#training">Training</a>
            <a href="#approach">Our Approach</a>
            <a href="#contact">Contact</a>
            <a
              className="nav-cta"
              href="https://wa.me/60195193834"
              target="_blank"
              rel="noreferrer"
            >
              WhatsApp
            </a>
          </nav>

          <MobileNav />
        </div>
      </header>

      <section className="hero" id="home">
        <div className="container hero-grid">
          <div className="hero-copy">
            <span className="eyebrow">TERAS UNIVERSAL SDN. BHD. · 976732-P</span>
            <h1>
              Building Competence.
              <br />
              <span>Creating Opportunities.</span>
            </h1>
            <p className="hero-lead">
              Professional industrial safety training and consultancy designed
              to help organisations develop a safer, more capable and
              industry-ready workforce.
            </p>
            <div className="hero-actions">
              <a className="btn btn-primary" href="#contact">
                Request Training Information
              </a>
              <a
                className="btn btn-outline"
                href="https://wa.me/60195193834?text=Hello%20TERAS%20UNIVERSAL%2C%20I%20would%20like%20to%20enquire%20about%20your%20training%20programmes."
                target="_blank"
                rel="noreferrer"
              >
                WhatsApp Our Team
              </a>
            </div>
            <div className="trust-row">
              <span>Industry-focused</span>
              <span>Practical learning</span>
              <span>Custom programmes</span>
            </div>
          </div>

          <div className="premium-visual" aria-label="TERAS UNIVERSAL training highlights">
            <div className="visual-orbit orbit-one" />
            <div className="visual-orbit orbit-two" />
            <div className="visual-core">
              <span className="visual-kicker">Professional Training</span>
              <h2>Safety. Skills. Opportunity.</h2>
              <p>Structured learning with practical relevance for the modern workplace.</p>
              <div className="visual-badges">
                <span>Safety</span>
                <span>Competency</span>
                <span>Consultancy</span>
              </div>
            </div>
            <div className="floating-card card-one">
              <strong>01</strong>
              <span>Theory-led foundations</span>
            </div>
            <div className="floating-card card-two">
              <strong>02</strong>
              <span>Practical application</span>
            </div>
            <div className="floating-card card-three">
              <strong>03</strong>
              <span>Industry relevance</span>
            </div>
          </div>
        </div>
      </section>

      <section id="about">
        <div className="container about-grid">
          <div>
            <span className="eyebrow">About TERAS</span>
            <h2>Training that strengthens people and organisations.</h2>
          </div>
          <div className="about-copy">
            <p>
              TERAS UNIVERSAL delivers industrial safety training, skills
              development and consultancy solutions for individuals,
              organisations and industry partners.
            </p>
            <p>
              Our programmes are designed to be clear, structured and relevant
              to real workplace expectations.
            </p>
          </div>
        </div>

        <div className="container value-grid">
          <article>
            <span>01</span>
            <h3>Professional Delivery</h3>
            <p>Structured learning presented in a clear, practical and accessible format.</p>
          </article>
          <article>
            <span>02</span>
            <h3>Industry Relevance</h3>
            <p>Programme content developed around real workplace needs and expectations.</p>
          </article>
          <article>
            <span>03</span>
            <h3>Flexible Solutions</h3>
            <p>Training formats that can be adapted to participant and organisational requirements.</p>
          </article>
        </div>
      </section>

      <section id="training" className="soft-section">
        <div className="container">
          <div className="section-heading split-heading">
            <div>
              <span className="eyebrow">Training Programmes</span>
              <h2>Practical programmes for safer and stronger workplaces.</h2>
            </div>
            <p>
              Programme content and duration can be tailored according to your
              operational objectives and participant profile.
            </p>
          </div>

          <div className="programme-grid">
            {programmes.map(([number, title, text]) => (
              <article key={title}>
                <span>{number}</span>
                <h3>{title}</h3>
                <p>{text}</p>
                <a href="#contact">Enquire now →</a>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="approach">
        <div className="container">
          <div className="section-heading">
            <span className="eyebrow">Our Approach</span>
            <h2>A clear process from first discussion to programme delivery.</h2>
          </div>

          <div className="approach-grid">
            {approach.map(([title, text], index) => (
              <article key={title}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <h3>{title}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="premium-cta-section">
        <div className="container premium-cta">
          <div>
            <span>Corporate & Custom Training</span>
            <h2>Need a programme built around your workforce?</h2>
            <p>
              Share your objectives, preferred date and participant details.
              Our team will help prepare a suitable proposal.
            </p>
          </div>
          <a className="btn btn-light" href="#contact">Discuss Your Requirements</a>
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
                  <div>
                    <dt>Phone</dt>
                    <dd><a href="tel:+60195193834">+60 19-519 3834</a></dd>
                  </div>
                  <div>
                    <dt>Administration</dt>
                    <dd><a href="mailto:admin@terasuniversal.com.my">admin@terasuniversal.com.my</a></dd>
                  </div>
                  <div>
                    <dt>Training</dt>
                    <dd><a href="mailto:training@terasuniversal.com.my">training@terasuniversal.com.my</a></dd>
                  </div>
                  <div>
                    <dt>Address</dt>
                    <dd>Lot 1961, Jalan Tanah Merah, Kg Tanah Merah Dalam, 06000 Jitra, Kedah, Malaysia</dd>
                  </div>
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

      <a
        className="floating-whatsapp"
        href="https://wa.me/60195193834?text=Hello%20TERAS%20UNIVERSAL%2C%20I%20would%20like%20to%20enquire%20about%20your%20training%20programmes."
        target="_blank"
        rel="noreferrer"
        aria-label="Contact TERAS UNIVERSAL on WhatsApp"
      >
        WA
      </a>

      <footer>
        <div className="container footer-grid">
          <div className="footer-brand">
            <Image src="/teras-universal-logo.png" alt="TERAS UNIVERSAL" width={210} height={135} />
            <p>Building Competence.<br />Creating Opportunities.</p>
          </div>
          <div>
            <h3>Company</h3>
            <p>TERAS UNIVERSAL SDN. BHD.<br />(976732-P)</p>
            <p>Industrial Safety Training & Consultancy</p>
          </div>
          <div>
            <h3>Contact</h3>
            <p>
              <a href="mailto:training@terasuniversal.com.my">training@terasuniversal.com.my</a><br />
              <a href="tel:+60195193834">+60 19-519 3834</a>
            </p>
            <p>Lot 1961, Jalan Tanah Merah,<br />Kg Tanah Merah Dalam,<br />06000 Jitra, Kedah, Malaysia</p>
          </div>
        </div>
        <div className="container footer-bottom">
          <span>© 2026 TERAS UNIVERSAL SDN. BHD. All rights reserved.</span>
          <span>terasuniversal.com.my</span>
        </div>
      </footer>
    </main>
  );
}
