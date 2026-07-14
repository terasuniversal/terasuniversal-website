import Image from "next/image";
import ContactForm from "../components/ContactForm";
import MobileNav from "../components/MobileNav";

const pillars = [
  ["01", "Industrial Safety", "High-risk safety training that strengthens hazard awareness, procedural compliance and safe workplace performance.", ["Working at Height", "Confined Space", "Scaffolding"]],
  ["02", "Technical Competency", "Structured technical learning and practical competency pathways for machinery, equipment and specialist tasks.", ["Equipment Handling", "Scaffold Inspection", "Competency Assessment"]],
  ["03", "Industrial Consultancy", "Practical solutions that transform operational risks and compliance gaps into clear, actionable improvement plans.", ["HSE Audit", "Risk Assessment", "Site Inspection"]],
  ["04", "Workforce Development", "Customised frameworks that connect employee development with operational requirements and business objectives.", ["Upskilling", "Supervisor Development", "Corporate Training"]],
];

const programmes = [
  ["01", "Scaffolding Competency", "Core scaffolding knowledge, safe erection practices, inspection awareness and practical competency development."],
  ["02", "Working at Height", "Safe access, fall prevention, equipment awareness and practical control measures for elevated work."],
  ["03", "Confined Space Safety", "Hazard awareness, entry principles, control measures and emergency preparedness for confined-space work."],
  ["04", "Safety Passport", "Essential safety responsibilities, hazard recognition and workplace controls for industry personnel."],
  ["05", "Scaffolding Inspection", "Structured inspection knowledge covering scaffold condition, safe-use requirements and reporting."],
  ["06", "Lifting Awareness", "Fundamental lifting-operation safety, communication, signalling and risk-control awareness."],
  ["07", "Foreign Worker Skills", "Targeted safety and skills development to strengthen understanding, discipline and workplace performance."],
  ["08", "Custom Corporate Training", "Tailored programmes aligned with your workforce profile, project risks and operational objectives."],
];

const reasons = [
  ["Industry-Experienced Trainers", "Relevant technical knowledge, practical exposure and understanding of real industrial environments."],
  ["Practical Training", "Demonstrations, simulations and hands-on exercises that connect theory with workplace execution."],
  ["Competency-Based Learning", "Clear learning outcomes supported by structured knowledge and practical assessments."],
  ["Customised Corporate Solutions", "Programmes tailored to your workforce, procedures, site conditions and business objectives."],
  ["Compliance-Focused Approach", "Solutions designed to strengthen safer operations, audit readiness and organisational compliance."],
  ["Flexible Delivery", "Public, in-house, onsite and project-based delivery options according to programme requirements."],
];

const methodology = ["Need Analysis", "Programme Planning", "Theory", "Practical", "Assessment", "Certification", "Continuous Improvement"];
const industries = ["Oil & Gas", "Petrochemical", "Construction", "Power & Utilities", "Manufacturing", "Marine & Offshore", "Heavy Industry", "Government & GLC"];

export default function HomePage() {
  return (
    <main>
      <header className="site-header">
        <div className="container nav-wrap">
          <a className="brand" href="#home" aria-label="TERAS UNIVERSAL home">
            <Image src="/teras-universal-logo.png" alt="TERAS UNIVERSAL logo" width={220} height={140} priority />
          </a>
          <nav className="desktop-nav" aria-label="Main navigation">
            <a href="#about">About</a><a href="#services">Services</a><a href="#training">Training</a><a href="#industries">Industries</a><a href="#contact">Contact</a>
            <a className="nav-cta" href="https://wa.me/60195193834" target="_blank" rel="noreferrer">WhatsApp</a>
          </nav>
          <MobileNav />
        </div>
      </header>

      <section className="hero" id="home">
        <div className="container hero-grid">
          <div className="hero-copy">
            <span className="eyebrow">Malaysia’s Industrial Safety & Competency Partner</span>
            <h1>Building Competence for <span>Safer, Stronger Industries.</span></h1>
            <p className="hero-lead">TERAS UNIVERSAL provides competency-based industrial safety training, technical development, consultancy and workforce solutions for safety-critical organisations.</p>
            <div className="hero-actions">
              <a className="btn btn-primary" href="#training">Explore Our Training</a>
              <a className="btn btn-outline" href="#contact">Request a Corporate Proposal</a>
            </div>
            <div className="trust-row"><span>Practical learning</span><span>Compliance focused</span><span>Custom corporate programmes</span></div>
          </div>
          <div className="premium-visual" aria-label="TERAS UNIVERSAL service highlights">
            <div className="visual-orbit orbit-one" /><div className="visual-orbit orbit-two" />
            <div className="visual-core"><span className="visual-kicker">The Standard of Competence</span><h2>Safety. Skills. Compliance.</h2><p>Structured learning and practical solutions designed around the realities of modern industry.</p><div className="visual-badges"><span>Industrial Safety</span><span>Technical Competency</span><span>Consultancy</span></div></div>
            <div className="floating-card card-one"><strong>01</strong><span>Analyse operational needs</span></div>
            <div className="floating-card card-two"><strong>02</strong><span>Develop practical capability</span></div>
            <div className="floating-card card-three"><strong>03</strong><span>Verify workplace competence</span></div>
          </div>
        </div>
      </section>

      <section id="about">
        <div className="container about-grid">
          <div><span className="eyebrow">About TERAS UNIVERSAL</span><h2>The Standard of Competence.</h2></div>
          <div className="about-copy"><p>TERAS UNIVERSAL SDN. BHD. is a Malaysian training and industrial consultancy company specialising in occupational safety and health, scaffolding, working at height, confined space, technical competency and workforce development.</p><p>We integrate regulatory compliance, technical knowledge, practical workplace skills and structured assessment to help organisations close skill gaps, strengthen risk controls and build safer, more capable teams.</p></div>
        </div>
        <div className="container value-grid">
          <article><span>T</span><h3>Trust</h3><p>Integrity, transparency and consistent professional delivery.</p></article>
          <article><span>E</span><h3>Excellence</h3><p>High standards in content, delivery, assessment and service.</p></article>
          <article><span>S</span><h3>Safety</h3><p>Risk reduction and workforce protection at the centre of every solution.</p></article>
        </div>
      </section>

      <section id="services" className="soft-section">
        <div className="container">
          <div className="section-heading split-heading"><div><span className="eyebrow">Four Core Service Pillars</span><h2>Integrated solutions for competence, compliance and performance.</h2></div><p>From high-risk safety training to workforce strategy, every service is structured around measurable workplace requirements.</p></div>
          <div className="pillar-grid">{pillars.map(([number,title,text,items])=><article key={title}><span>{number}</span><h3>{title}</h3><p>{text}</p><ul>{items.map(item=><li key={item}>{item}</li>)}</ul><a href="#contact">Discuss this service →</a></article>)}</div>
        </div>
      </section>

      <section className="why-section">
        <div className="container">
          <div className="section-heading"><span className="eyebrow">Why Choose TERAS</span><h2>Built around real operational needs—not generic training.</h2></div>
          <div className="reason-grid">{reasons.map(([title,text],index)=><article key={title}><span>{String(index+1).padStart(2,"0")}</span><div><h3>{title}</h3><p>{text}</p></div></article>)}</div>
        </div>
      </section>

      <section id="training" className="soft-section">
        <div className="container">
          <div className="section-heading split-heading"><div><span className="eyebrow">Featured Training Programmes</span><h2>Practical programmes for safer and stronger workplaces.</h2></div><p>Programme scope and duration can be tailored to participant profiles, site risks and operational objectives.</p></div>
          <div className="programme-grid">{programmes.map(([number,title,text])=><article key={title}><span>{number}</span><h3>{title}</h3><p>{text}</p><a href="#contact">Enquire now →</a></article>)}</div>
        </div>
      </section>

      <section id="industries">
        <div className="container">
          <div className="section-heading"><span className="eyebrow">Industries We Serve</span><h2>Supporting safety-critical industries.</h2><p>Our programmes support organisations where technical competence, operational reliability and compliance are essential.</p></div>
          <div className="industry-grid">{industries.map((industry,index)=><article key={industry}><span>{String(index+1).padStart(2,"0")}</span><h3>{industry}</h3></article>)}</div>
        </div>
      </section>

      <section id="methodology" className="method-section">
        <div className="container"><div className="section-heading"><span className="eyebrow">Training Methodology</span><h2>A structured pathway from need to competence.</h2></div><div className="method-grid">{methodology.map((step,index)=><article key={step}><span>{String(index+1).padStart(2,"0")}</span><h3>{step}</h3></article>)}</div></div>
      </section>

      <section className="premium-cta-section"><div className="container premium-cta"><div><span>Corporate & Custom Solutions</span><h2>Ready to strengthen your workforce competency?</h2><p>Speak with our team about a training or consultancy solution aligned with your operational requirements.</p></div><a className="btn btn-light" href="#contact">Request a Proposal</a></div></section>

      <section id="contact" className="contact-section">
        <div className="container"><div className="section-heading"><span className="eyebrow">Contact Us</span><h2>Let us discuss your requirements.</h2></div><div className="contact-layout"><ContactForm /><div className="contact-details"><div className="detail-card"><h3>TERAS UNIVERSAL SDN. BHD.</h3><p>Industrial Safety Training · Technical Competency · Consultancy</p><dl><div><dt>Phone</dt><dd><a href="tel:+60195193834">+60 19-519 3834</a></dd></div><div><dt>Training</dt><dd><a href="mailto:training@terasuniversal.com.my">training@terasuniversal.com.my</a></dd></div><div><dt>Administration</dt><dd><a href="mailto:admin@terasuniversal.com.my">admin@terasuniversal.com.my</a></dd></div><div><dt>Address</dt><dd>Lot 1961, Jalan Tanah Merah, Kg Tanah Merah Dalam, 06000 Jitra, Kedah, Malaysia</dd></div></dl></div><div className="map-card"><iframe title="TERAS UNIVERSAL location" src="https://www.google.com/maps?q=Lot%201961%2C%20Jalan%20Tanah%20Merah%2C%20Kg%20Tanah%20Merah%20Dalam%2C%2006000%20Jitra%2C%20Kedah%2C%20Malaysia&output=embed" loading="lazy" referrerPolicy="no-referrer-when-downgrade" /></div></div></div></div>
      </section>

      <a className="floating-whatsapp" href="https://wa.me/60195193834?text=Hello%20TERAS%20UNIVERSAL%2C%20I%20would%20like%20to%20enquire%20about%20your%20training%20and%20consultancy%20services." target="_blank" rel="noreferrer" aria-label="Contact TERAS UNIVERSAL on WhatsApp">WA</a>

      <footer><div className="container footer-grid"><div className="footer-brand"><Image src="/teras-universal-logo.png" alt="TERAS UNIVERSAL" width={210} height={135} /><p>Building Competence. Creating Opportunities.</p></div><div><h3>Core Services</h3><p>Industrial Safety<br/>Technical Competency<br/>Industrial Consultancy<br/>Workforce Development</p></div><div><h3>Contact</h3><p><a href="mailto:training@terasuniversal.com.my">training@terasuniversal.com.my</a><br/><a href="tel:+60195193834">+60 19-519 3834</a></p><p>Lot 1961, Jalan Tanah Merah,<br/>Kg Tanah Merah Dalam,<br/>06000 Jitra, Kedah, Malaysia</p></div></div><div className="container footer-bottom"><span>© 2026 TERAS UNIVERSAL SDN. BHD. All rights reserved.</span><span>terasuniversal.com.my</span></div></footer>
    </main>
  );
}
