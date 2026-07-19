"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import MobileNav from "../../components/MobileNav";

const categories = ["All Programmes", "Industrial Safety", "Technical Competency", "Assessment", "Workforce Development"];
const programmes = [
  { category: "Industrial Safety", title: "Scaffolding Competency", text: "Build foundational scaffolding knowledge, safe erection awareness and practical task discipline.", audience: "Scaffolders, supervisors and industrial work teams", image: "/images/temp-ai-scaffolding-practical.webp", industries: ["Construction", "Oil & Gas", "Manufacturing"] },
  { category: "Industrial Safety", title: "Working at Height", text: "Develop awareness of fall hazards, safe access, equipment use and workplace controls.", audience: "Workers, supervisors and site personnel", image: "/images/temp-ai-training-yard.webp", industries: ["Construction", "Oil & Gas", "Manufacturing"] },
  { category: "Industrial Safety", title: "Confined Space Safety", text: "Understand confined-space hazards, entry principles, control measures and emergency readiness.", audience: "Entry teams, standby personnel and supervisors", image: "/images/temp-ai-corporate-scene-05.webp", industries: ["Oil & Gas", "Manufacturing", "Construction"] },
  { category: "Industrial Safety", title: "Safety Passport", text: "Strengthen essential safety responsibilities, hazard recognition and workplace control awareness.", audience: "New starters, contractors and industry personnel", image: "/images/temp-ai-industrial-safety-briefing.webp", industries: ["Oil & Gas", "Construction", "Manufacturing"] },
  { category: "Industrial Safety", title: "Lifting Awareness", text: "Build practical awareness of lifting operations, communication, signalling and risk controls.", audience: "Lifting teams, banksmen and supervisors", image: "/images/temp-ai-corporate-scene-06.webp", industries: ["Construction", "Oil & Gas", "Manufacturing"] },
  { category: "Industrial Safety", title: "PPE & Workplace Safety", text: "Connect PPE selection, inspection and safe work habits with everyday operational discipline.", audience: "All workplace personnel and supervisors", image: "/images/temp-ai-ppe-equipment.webp", industries: ["Construction", "Oil & Gas", "Manufacturing"] },
  { category: "Technical Competency", title: "Scaffolding Inspection", text: "Develop structured inspection awareness covering scaffold condition, safe use and reporting.", audience: "Inspectors, supervisors and technical personnel", image: "/images/temp-ai-corporate-scene-03.webp", industries: ["Construction", "Oil & Gas", "Manufacturing"] },
  { category: "Technical Competency", title: "Equipment Handling", text: "Build knowledge and supervised practice around safe handling of industrial equipment.", audience: "Operators, technicians and work teams", image: "/images/temp-ai-technical-equipment.webp", industries: ["Oil & Gas", "Manufacturing", "Construction"] },
  { category: "Technical Competency", title: "Machinery Safety", text: "Explore machinery hazards, operating discipline, safeguards and practical risk controls.", audience: "Operators, technicians and supervisors", image: "/images/temp-ai-corporate-scene-07.webp", industries: ["Manufacturing", "Construction", "Oil & Gas"] },
  { category: "Technical Competency", title: "Technical Skills Development", text: "Create a structured pathway from technical understanding to job-relevant practical capability.", audience: "Technical teams and developing personnel", image: "/images/temp-ai-corporate-scene-08.webp", industries: ["Manufacturing", "Oil & Gas", "Construction"] },
  { category: "Assessment", title: "Competency Assessment", text: "Evaluate theoretical understanding and practical execution against defined programme requirements.", audience: "Participants, supervisors and employers", image: "/images/temp-ai-competency-assessment.webp", industries: ["Oil & Gas", "Construction", "Manufacturing"] },
  { category: "Assessment", title: "Practical Skills Assessment", text: "Review practical task performance through structured observation and defined criteria.", audience: "Operators, technicians and work teams", image: "/images/temp-ai-corporate-scene-13.webp", industries: ["Manufacturing", "Construction", "Oil & Gas"] },
  { category: "Assessment", title: "Refresher Assessment", text: "Revisit essential knowledge and practical performance to support ongoing workforce readiness.", audience: "Experienced workers and returning personnel", image: "/images/temp-ai-corporate-scene-14.webp", industries: ["Oil & Gas", "Manufacturing", "Construction"] },
  { category: "Workforce Development", title: "Corporate In-House Training", text: "Align a focused programme with one organisation, department, project team or workforce group.", audience: "Organisations, departments and project teams", image: "/images/temp-ai-corporate-scene-02.webp", industries: ["Oil & Gas", "Construction", "Manufacturing"] },
  { category: "Workforce Development", title: "Foreign Worker Skills Programme", text: "Support clearer understanding of workplace expectations, safety practices and practical task execution.", audience: "Foreign workers and workforce supervisors", image: "/images/temp-ai-corporate-scene-04.webp", industries: ["Construction", "Manufacturing", "Oil & Gas"] },
  { category: "Workforce Development", title: "Supervisor Development", text: "Strengthen communication, task planning, safety leadership and practical team coordination.", audience: "Supervisors, team leaders and coordinators", image: "/images/temp-ai-corporate-scene-12.webp", industries: ["Oil & Gas", "Construction", "Manufacturing"] },
  { category: "Workforce Development", title: "Custom Workforce Programme", text: "Shape a programme around participant profiles, operational risks, procedures and learning outcomes.", audience: "Organisations with specific development needs", image: "/images/temp-ai-corporate-scene-11.webp", industries: ["Oil & Gas", "Manufacturing", "Construction"] },
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
  const visibleProgrammes = useMemo(() => activeCategory === "All Programmes" ? programmes : programmes.filter(({ category }) => category === activeCategory), [activeCategory]);

  return (
    <main className="training-page">
      <header className="site-header">
        <div className="container nav-wrap">
          <a className="brand" href="/" aria-label="TERAS UNIVERSAL home"><Image src="/teras-universal-logo.png" alt="TERAS UNIVERSAL logo" width={220} height={140} priority sizes="154px" /></a>
          <nav className="desktop-nav" aria-label="Main navigation">
            <a href="/#about">About</a><a href="/#services">Services</a><a href="/training">Training</a><a href="/#industries">Industries</a><a href="/#faq">FAQ</a><a href="/#contact">Contact</a><a href="/verify">Verify Certificate</a>
            <a className="nav-proposal" href="/request-proposal">Request Proposal</a><a className="nav-cta" href="https://wa.me/60195193834" target="_blank" rel="noreferrer">WhatsApp</a>
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
            <div className="training-hero-features" aria-label="Training strengths">
              <span>Practical Delivery</span><span>Industry Focused</span><span>Competency Based</span><span>Custom Programmes</span>
            </div>
          </div>
          <figure className="training-hero-media">
            <Image src="/images/temp-ai-industrial-safety-briefing.webp" alt="AI-generated industrial safety briefing in a modern training environment." width={1200} height={800} priority sizes="(max-width: 920px) 100vw, 52vw" />
            <div className="training-hero-floating-badges" aria-label="Training benefits">
              <span>Practical Training</span><span>Competency Based</span><span>Industry Ready</span>
            </div>
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
            {visibleProgrammes.map(({ category, title, text, audience, image, industries }) => (
              <article className="training-programme-card" key={title}>
                <div className="training-programme-media"><Image src={image} alt={`${title} training activity in an industrial workplace.`} width={900} height={506} sizes="(max-width: 590px) 100vw, (max-width: 920px) 50vw, 25vw" /></div>
                <div className="training-programme-content">
                  <span className="training-card-category">{category}</span>
                  <h3>{title}</h3>
                  <p>{text}</p>
                  <div className="training-card-badges" aria-label="Programme features"><span>Practical</span><span>Theory</span><span>Assessment</span></div>
                  <div className="training-card-industries" aria-label="Relevant industries">{industries.map((industry) => <span key={industry}>{industry}</span>)}</div>
                  <p className="training-card-audience"><strong>Suitable for</strong>{audience}</p>
                  <a className="training-card-link" href={title === "Scaffolding Competency" ? "/training/scaffolding-competency" : "/#contact"}>Enquire about this programme <span aria-hidden="true">&rarr;</span></a>
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

      <section className="training-corporate-cta"><div className="container"><div><span className="eyebrow">Corporate &amp; Custom Solutions</span><h2>Need a Programme Built Around Your Workforce?</h2><p>Speak with our team about a customised training solution aligned with your operational requirements, participant profile and preferred delivery arrangement.</p></div><div className="hero-actions"><a className="btn btn-light" href="/request-proposal">Request a Proposal</a><a className="btn btn-gold" href="https://wa.me/60195193834" target="_blank" rel="noreferrer">WhatsApp Our Team</a></div></div></section>

      <footer><div className="container footer-grid"><div className="footer-brand"><Image src="/teras-universal-logo.png" alt="TERAS UNIVERSAL" width={210} height={135} sizes="190px" /><p>Building Competence. Creating Opportunities.</p></div><div><h3>Core Services</h3><p>Industrial Safety<br />Technical Competency<br />Industrial Consultancy<br />Workforce Development</p></div><div><h3>Contact</h3><p><a href="mailto:training@terasuniversal.com.my">training@terasuniversal.com.my</a><br /><a href="tel:+60195193834">+60 19-519 3834</a></p><p>Lot 1961, Jalan Tanah Merah,<br />Kg Tanah Merah Dalam,<br />06000 Jitra, Kedah, Malaysia</p></div></div><div className="container footer-bottom"><span>&copy; 2026 TERAS UNIVERSAL SDN. BHD. All rights reserved.</span><span>terasuniversal.com.my</span></div></footer>
    </main>
  );
}
