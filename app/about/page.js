import Image from "next/image";
import MobileNav from "../../components/MobileNav";

const values = [
  ["T", "Trust", "We build relationships through integrity, transparency and dependable delivery."],
  ["E", "Excellence", "We pursue high standards across content, facilitation, assessment and service."],
  ["R", "Responsibility", "We consider people, operations and workplace impact in every solution."],
  ["A", "Accountability", "We take clear ownership of quality, commitments and continuous improvement."],
  ["S", "Safety", "We keep risk reduction and workforce protection at the centre of our work."],
];
const reasons = [
  ["01", "Industry-focused programmes", "Training shaped around the hazards, roles and realities of industrial workplaces."],
  ["02", "Practical learning", "Demonstrations, guided exercises and workplace scenarios that connect knowledge with action."],
  ["03", "Competency-based methodology", "Clear outcomes supported by structured theory, practical learning and assessment."],
  ["04", "Customised delivery", "Programme scope and arrangements shaped around participant profiles and operational needs."],
  ["05", "Compliance-focused approach", "Solutions designed to strengthen safe operations, control awareness and readiness."],
  ["06", "Flexible delivery options", "Public, in-house, onsite and assessment arrangements according to programme requirements."],
];
const approach = ["Understand Needs", "Plan", "Deliver", "Assess", "Improve"];
const industries = ["Oil & Gas", "Construction", "Manufacturing", "Marine & Offshore", "Power & Utilities", "Government & GLC"];

export default function AboutPage() {
  return (
    <main className="about-page">
      <header className="site-header">
        <div className="container nav-wrap">
          <a className="brand" href="/" aria-label="TERAS UNIVERSAL home"><Image src="/teras-universal-logo.png" alt="TERAS UNIVERSAL logo" width={220} height={140} priority sizes="154px" /></a>
          <nav className="desktop-nav" aria-label="Main navigation">
            <a href="/#about">About</a><a href="/services">Services</a><a href="/training">Training</a><a href="/#industries">Industries</a><a href="/#faq">FAQ</a><a href="/#contact">Contact</a>
            <a className="nav-cta" href="https://wa.me/60195193834" target="_blank" rel="noreferrer">WhatsApp</a>
          </nav>
          <MobileNav basePath="/" />
        </div>
      </header>

      <section className="about-hero" aria-labelledby="about-hero-title">
        <div className="container about-hero-grid">
          <div className="about-hero-copy">
            <span className="eyebrow">About TERAS Universal</span>
            <h1 id="about-hero-title">Building Competence.<br /><span>Creating Opportunities.</span></h1>
            <p>TERAS UNIVERSAL delivers competency-based industrial safety training, technical competency development, consultancy and workforce capability solutions designed to help organisations operate more safely, efficiently and confidently.</p>
            <div className="hero-actions"><a className="btn btn-primary" href="/training">Explore Training</a><a className="btn btn-outline" href="/#contact">Contact Us</a></div>
          </div>
          <figure className="about-hero-media"><Image src="/images/temp-ai-homepage-hero.webp" alt="AI-generated industrial trainer briefing participants in modern PPE at an industrial site." width={1800} height={1200} priority sizes="(max-width: 920px) 100vw, 52vw" /></figure>
        </div>
      </section>

      <section className="about-story-section" aria-labelledby="story-title">
        <div className="container about-story-grid">
          <div className="about-story-copy"><span className="eyebrow">Our Story</span><h2 id="story-title">Practical capability for the work that matters.</h2><p>TERAS UNIVERSAL was established to help organisations develop safer, more capable and more confident workforces through learning that connects directly to the workplace.</p><p>Our focus is practical industrial learning: clear knowledge, guided application, structured assessment and solutions that reflect the needs of people, projects and operations.</p><p>We aim to build long-term partnerships with organisations by listening carefully, delivering responsibly and continuously improving the way capability is developed.</p></div>
          <figure className="about-story-media"><Image src="/images/temp-ai-corporate-scene-02.webp" alt="AI-generated corporate discussion in a modern industrial training environment." width={1200} height={800} sizes="(max-width: 920px) 100vw, 50vw" /></figure>
        </div>
      </section>

      <section className="about-vision-section" aria-labelledby="vision-title">
        <div className="container"><div className="section-heading about-section-heading"><span className="eyebrow">Direction &amp; Purpose</span><h2 id="vision-title">A clear direction for meaningful workforce development.</h2></div><div className="about-vision-grid"><article><span className="about-card-number">01</span><h3>Vision</h3><p>To be a trusted partner in building safer, more competent and more resilient workforces.</p></article><article><span className="about-card-number">02</span><h3>Mission</h3><p>To deliver practical, competency-based training and industrial solutions that help organisations strengthen people, performance and workplace confidence.</p></article></div></div>
      </section>

      <section className="about-values-section" aria-labelledby="values-title">
        <div className="container"><div className="section-heading about-section-heading"><span className="eyebrow">TERAS Values</span><h2 id="values-title">The principles behind every engagement.</h2></div><div className="about-values-grid">{values.map(([icon, title, text]) => <article key={title}><span className="about-value-icon" aria-hidden="true">{icon}</span><h3>{title}</h3><p>{text}</p></article>)}</div></div>
      </section>

      <section className="about-reasons-section" aria-labelledby="reasons-title">
        <div className="container"><div className="section-heading about-section-heading"><span className="eyebrow">Why Organisations Choose TERAS</span><h2 id="reasons-title">Capability built around real organisational needs.</h2></div><div className="about-reasons-grid">{reasons.map(([number, title, text]) => <article key={title}><span>{number}</span><div><h3>{title}</h3><p>{text}</p></div></article>)}</div></div>
      </section>

      <section className="about-approach-section" aria-labelledby="approach-title">
        <div className="container"><div className="section-heading about-section-heading"><span className="eyebrow">Our Approach</span><h2 id="approach-title">A disciplined path from understanding to improvement.</h2></div><div className="about-approach-grid">{approach.map((stage, index) => <article key={stage}><span>{String(index + 1).padStart(2, "0")}</span><h3>{stage}</h3>{index < approach.length - 1 && <b aria-hidden="true">&rarr;</b>}</article>)}</div></div>
      </section>

      <section className="about-industries-section" aria-labelledby="about-industries-title">
        <div className="container"><div className="section-heading about-section-heading"><span className="eyebrow">Industries We Support</span><h2 id="about-industries-title">Built for safety-critical environments.</h2></div><div className="about-industries-grid">{industries.map((industry, index) => <article key={industry}><span>{String(index + 1).padStart(2, "0")}</span><h3>{industry}</h3></article>)}</div></div>
      </section>

      <section className="about-commitment-section"><div className="container"><span className="eyebrow">Corporate Commitment</span><h2>Committed to Building Safer and More Competent Workforces</h2><p>We work with organisations that value practical capability, responsible delivery and long-term improvement. Every engagement is an opportunity to help people perform with greater understanding, discipline and confidence.</p></div></section>

      <section className="about-final-cta"><div className="container"><div><span className="eyebrow">Let's Work Together</span><h2>Let&apos;s Build Capability Together</h2></div><div className="hero-actions"><a className="btn btn-light" href="/#contact">Request Proposal</a><a className="btn btn-gold" href="/#contact">Contact Us</a></div></div></section>

      <footer><div className="container footer-grid"><div className="footer-brand"><Image src="/teras-universal-logo.png" alt="TERAS UNIVERSAL" width={210} height={135} sizes="190px" /><p>Building Competence. Creating Opportunities.</p></div><div><h3>Core Services</h3><p>Industrial Safety<br />Technical Competency<br />Industrial Consultancy<br />Workforce Development</p></div><div><h3>Quick Links</h3><p><a href="/about">About</a><br /><a href="/training">Training</a><br /><a href="/services">Services</a><br /><a href="/#contact">Contact</a></p></div><div><h3>Contact</h3><p><a href="mailto:training@terasuniversal.com.my">training@terasuniversal.com.my</a><br /><a href="tel:+60195193834">+60 19-519 3834</a></p><p>Lot 1961, Jalan Tanah Merah,<br />Kg Tanah Merah Dalam,<br />06000 Jitra, Kedah, Malaysia</p></div></div><div className="container footer-bottom"><span>&copy; 2026 TERAS UNIVERSAL SDN. BHD. All rights reserved.</span><span>terasuniversal.com.my</span></div></footer>
    </main>
  );
}