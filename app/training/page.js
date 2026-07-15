"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import MobileNav from "../../components/MobileNav";

const categories = ["All Programmes", "Industrial Safety", "Technical Competency", "Assessment", "Workforce Development"];
const programmes = [
  ["Industrial Safety", "Scaffolding Competency", "Build foundational scaffolding knowledge, safe erection awareness and practical task discipline.", "Public · In-house · Onsite", "Scaffolders, supervisors and industrial work teams", "/images/temp-ai-scaffolding-practical.webp"],
  ["Industrial Safety", "Working at Height", "Develop awareness of fall hazards, safe access, equipment use and workplace controls.", "Public · In-house · Onsite", "Workers, supervisors and site personnel", "/images/temp-ai-training-yard.webp"],
  ["Industrial Safety", "Confined Space Safety", "Understand confined-space hazards, entry principles, control measures and emergency readiness.", "In-house · Onsite", "Entry teams, standby personnel and supervisors", "/images/temp-ai-corporate-scene-05.webp"],
  ["Industrial Safety", "Safety Passport", "Strengthen essential safety responsibilities, hazard recognition and workplace control awareness.", "Public · In-house", "New starters, contractors and industry personnel", "/images/temp-ai-industrial-safety-briefing.webp"],
  ["Industrial Safety", "Lifting Awareness", "Build practical awareness of lifting operations, communication, signalling and risk controls.", "Public · In-house · Onsite", "Lifting teams, banksmen and supervisors", "/images/temp-ai-corporate-scene-06.webp"],
  ["Industrial Safety", "PPE & Workplace Safety", "Connect PPE selection, inspection and safe work habits with everyday operational discipline.", "Public · In-house · Onsite", "All workplace personnel and supervisors", "/images/temp-ai-ppe-equipment.webp"],
  ["Technical Competency", "Scaffolding Inspection", "Develop structured inspection awareness covering scaffold condition, safe use and reporting.", "In-house · Onsite", "Inspectors, supervisors and technical personnel", "/images/temp-ai-corporate-scene-03.webp"],
  ["Technical Competency", "Equipment Handling", "Build knowledge and supervised practice around safe handling of industrial equipment.", "In-house · Onsite", "Operators, technicians and work teams", "/images/temp-ai-corporate-scene-06.webp"],
  ["Technical Competency", "Machinery Safety", "Explore machinery hazards, operating discipline, safeguards and practical risk controls.", "In-house · Onsite", "Operators, technicians and supervisors", "/images/temp-ai-corporate-scene-07.webp"],
  ["Technical Competency", "Technical Skills Development", "Create a structured pathway from technical understanding to job-relevant practical capability.", "In-house · Onsite", "Technical teams and developing personnel", "/images/temp-ai-technical-equipment.webp"],
  ["Assessment", "Competency Assessment", "Evaluate theoretical understanding and practical execution against defined programme requirements.", "In-house · Onsite", "Participants, supervisors and employers", "/images/temp-ai-competency-assessment.webp"],
  ["Assessment", "Practical Skills Assessment", "Review practical task performance through structured observation and defined criteria.", "Onsite", "Operators, technicians and work teams", "/images/temp-ai-corporate-scene-13.webp"],
  ["Assessment", "Refresher Assessment", "Revisit essential knowledge and practical performance to support ongoing workforce readiness.", "In-house · Onsite", "Experienced workers and returning personnel", "/images/temp-ai-corporate-scene-14.webp"],
  ["Workforce Development", "Corporate In-House Training", "Align a focused programme with one organisation, department, project team or workforce group.", "In-house", "Organisations, departments and project teams", "/images/temp-ai-corporate-scene-02.webp"],
  ["Workforce Development", "Foreign Worker Skills Programme", "Support clearer understanding of workplace expectations, safety practices and practical task execution.", "In-house · Onsite", "Foreign workers and workforce supervisors", "/images/temp-ai-corporate-scene-04.webp"],
  ["Workforce Development", "Supervisor Development", "Strengthen communication, task planning, safety leadership and practical team coordination.", "In-house · Onsite", "Supervisors, team leaders and coordinators", "/images/temp-ai-corporate-scene-12.webp"],
  ["Workforce Development", "Custom Workforce Programme", "Shape a programme around participant profiles, operational risks, procedures and learning outcomes.", "In-house · Onsite", "Organisations with specific development needs", "/images/temp-ai-corporate-scene-11.webp"],
];
const deliveryOptions = [
  ["01", "Public Programme", "Scheduled learning for individuals and employees from different organisations."],
  ["02", "In-House Training", "A focused programme delivered exclusively for one organisation or workforce group."],
  ["03", "Onsite Training", "Practical learning arranged at a client workplace, plant, project site or approved facility."],
  ["04", "Competency Assessment", "Structured theoretical and practical evaluation against defined requirements."],
];
const process = ["Need Analysis", "Programme Planning", "Theory", "Practical", "Assessment", "Certification", "Continuous Improvement"];

export default function TrainingPage() {
  const [activeCategory, setActiveCategory] = useState("All Programmes");
  const visibleProgrammes = useMemo(() => activeCategory === "All Programmes" ? programmes : programmes.filter(([category]) => category === activeCategory), [activeCategory]);

  return (
    <main className="training-page">
      <header className="site-header">
        <div className="container nav-wrap">
          <a className="brand" href="/" aria-label="TERAS UNIVERSAL home"><Image src="/teras-universal-logo.png" alt="TERAS UNIVERSAL logo" width={220} height={140} priority /></a>
          <nav className="desktop-nav" aria-label="Main navigation">
            <a href="/#about">About</a><a href="/#services">Services</a><a href="/training">Training</a><a href="/#industries">Industries</a><a href="/#faq">FAQ</a><a href="/#contact">Contact</a>
            <a className="nav-cta" href="https://wa.me/60195193834" target="_blank" rel="noreferrer">WhatsApp</a>
          </nav>
          <MobileNav basePath="/" />
        </div>
      </header>

      <section className="training-hero" aria-labelledby="training-hero-title">
        <div className="container training-hero-grid">
          <div className="training-hero-copy">
            <span className="eyebrow">Training Programmes</span>
            <h1 id="training-hero-title">Practical Training for Safer and More Competent Workforces</h1>
            <p>Explore competency-based industrial safety and technical training programmes designed around workplace risks, operational requirements and participant development needs.</p>
            <div className="hero-actions">
              <a className="btn btn-primary" href="/#contact">Request Training Information</a>
              <a className="btn btn-outline" href="https://wa.me/60195193834" target="_blank" rel="noreferrer">WhatsApp Our Team</a>
            </div>
          </div>
          <figure className="training-hero-media">
            <Image src="/images/temp-ai-industrial-safety-briefing.webp" alt="AI-generated industrial training visual for presentation purposes." width={1200} height={800} priority />
            <figcaption>AI-generated visual for presentation purposes.</figcaption>
          </figure>
        </div>
      </section>

      <section className="training-programmes-section" aria-labelledby="programme-title">
        <div className="container">
          <div className="section-heading training-section-heading">
            <span className="eyebrow">Programme Categories</span>
            <h2 id="programme-title">Build capability around the work that matters.</h2>
            <p>Choose a category to explore the training pathways available for your workforce and operational context.</p>
          </div>
          <div className="training-filters" role="group" aria-label="Filter training programmes">
            {categories.map((category) => <button key={category} type="button" className={activeCategory === category ? "is-active" : ""} aria-pressed={activeCategory === category} onClick={() => setActiveCategory(category)}>{category}</button>)}
          </div>
          <div className="training-programme-grid" aria-live="polite">
            {visibleProgrammes.map(([category, title, text, delivery, audience, image]) => (
              <article className="training-programme-card" key={title}>
                <div className="training-programme-media"><Image src={image} alt="AI-generated industrial training visual for presentation purposes." width={900} height={600} /></div>
                <div className="training-programme-content">
                  <span className="training-card-category">{category}</span>
                  <h3>{title}</h3>
                  <p>{text}</p>
                  <dl className="training-card-meta"><div><dt>Delivery</dt><dd>{delivery}</dd></div><div><dt>Suitable for</dt><dd>{audience}</dd></div></dl>
                  <a className="training-card-link" href="/#contact">Enquire about this programme <span aria-hidden="true">&rarr;</span></a>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="training-delivery-section" aria-labelledby="delivery-title">
        <div className="container">
          <div className="section-heading"><span className="eyebrow">Delivery Options</span><h2 id="delivery-title">A flexible arrangement for every organisation.</h2><p>Discuss the preferred format with our team and we can shape the arrangement around your participants, site and programme requirements.</p></div>
          <div className="training-delivery-grid">{deliveryOptions.map(([number, title, text]) => <article key={title}><span>{number}</span><h3>{title}</h3><p>{text}</p></article>)}</div>
        </div>
      </section>

      <section className="training-process-section" aria-labelledby="process-title">
        <div className="container">
          <div className="section-heading"><span className="eyebrow">Training Process</span><h2 id="process-title">A clear pathway from need to improvement.</h2><p>Each programme can follow a disciplined learning cycle that connects organisational needs with practical workplace performance.</p></div>
          <div className="training-process-grid">{process.map((stage, index) => <article key={stage}><span>{String(index + 1).padStart(2, "0")}</span><h3>{stage}</h3></article>)}</div>
        </div>
      </section>

      <section className="training-corporate-cta"><div className="container"><div><span className="eyebrow">Corporate &amp; Custom Solutions</span><h2>Need a Programme Built Around Your Workforce?</h2><p>Speak with our team about a customised training solution aligned with your operational requirements, participant profile and preferred delivery arrangement.</p></div><div className="hero-actions"><a className="btn btn-light" href="/#contact">Request a Proposal</a><a className="btn btn-gold" href="https://wa.me/60195193834" target="_blank" rel="noreferrer">WhatsApp Our Team</a></div></div></section>

      <footer><div className="container footer-grid"><div className="footer-brand"><Image src="/teras-universal-logo.png" alt="TERAS UNIVERSAL" width={210} height={135} /><p>Building Competence. Creating Opportunities.</p></div><div><h3>Core Services</h3><p>Industrial Safety<br />Technical Competency<br />Industrial Consultancy<br />Workforce Development</p></div><div><h3>Contact</h3><p><a href="mailto:training@terasuniversal.com.my">training@terasuniversal.com.my</a><br /><a href="tel:+60195193834">+60 19-519 3834</a></p><p>Lot 1961, Jalan Tanah Merah,<br />Kg Tanah Merah Dalam,<br />06000 Jitra, Kedah, Malaysia</p></div></div><div className="container footer-bottom"><span>&copy; 2026 TERAS UNIVERSAL SDN. BHD. All rights reserved.</span><span>terasuniversal.com.my</span></div></footer>
    </main>
  );
}
