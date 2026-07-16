import Image from "next/image";
import MobileNav from "../../components/MobileNav";

const pillars = [
  ["01", "Industrial Safety", "Strengthen hazard recognition, procedural discipline and safe task execution across safety-critical work environments.", ["Working at Height", "Confined Space", "Scaffolding", "Safety Passport", "Lifting Awareness", "PPE"], "Safer execution and stronger workplace controls", "#safety"],
  ["02", "Technical Competency", "Build job-relevant technical capability through structured understanding, guided practice and practical assessment.", ["Machinery", "Equipment", "Inspection", "Practical Skills", "Competency Development"], "More capable and dependable technical teams", "#technical"],
  ["03", "Industrial Consultancy", "Translate operational risks and compliance gaps into practical review, advisory and improvement priorities.", ["Risk Assessment", "Safety Audit", "Site Inspection", "Compliance Review", "HSE Consultancy"], "Clearer controls and improved audit readiness", "#consultancy"],
  ["04", "Workforce Development", "Align workforce capability with role requirements, project demands, organisational procedures and long-term development needs.", ["Corporate Training", "In-house Programme", "Competency Assessment", "Supervisor Development", "Foreign Worker Skills"], "A more prepared and adaptable workforce", "#workforce"],
];
const serviceDetails = [
  ["safety", "Industrial Safety", "Practical safety learning designed around real workplace hazards, controls and task execution.", ["Working at Height", "Confined Space", "Scaffolding", "Safety Passport", "Lifting Awareness", "PPE"], "/images/temp-ai-corporate-scene-05.webp"],
  ["technical", "Technical Competency", "Structured technical development that connects knowledge, equipment familiarity, practical skills and competency requirements.", ["Machinery", "Equipment", "Inspection", "Practical Skills", "Competency Development"], "/images/temp-ai-technical-equipment.webp"],
  ["consultancy", "Industrial Consultancy", "Practical advisory support to identify operational weaknesses, review controls and prioritise improvement actions.", ["Risk Assessment", "Safety Audit", "Site Inspection", "Compliance Review", "HSE Consultancy"], "/images/temp-ai-corporate-scene-08.webp"],
  ["workforce", "Workforce Development", "Role-focused programmes that help organisations build capability across teams, supervisors and workforce groups.", ["Corporate Training", "In-house Programme", "Competency Assessment", "Supervisor Development", "Foreign Worker Skills"], "/images/temp-ai-corporate-scene-12.webp"],
];
const serviceOutcomes = { safety: "Safer execution and stronger workplace controls", technical: "More capable and dependable technical teams", consultancy: "Clearer controls and improved audit readiness", workforce: "A more prepared and adaptable workforce" };
const process = ["Need Analysis", "Planning", "Training", "Assessment", "Improvement"];
const industries = ["Oil & Gas", "Construction", "Manufacturing", "Petrochemical", "Marine", "Utilities", "Government"];

export default function ServicesPage() {
  return (
    <main className="services-page">
      <header className="site-header">
        <div className="container nav-wrap">
          <a className="brand" href="/" aria-label="TERAS UNIVERSAL home"><Image src="/teras-universal-logo.png" alt="TERAS UNIVERSAL logo" width={220} height={140} priority sizes="154px" /></a>
          <nav className="desktop-nav" aria-label="Main navigation">
            <a href="/#about">About</a><a href="/services">Services</a><a href="/training">Training</a><a href="/#industries">Industries</a><a href="/#faq">FAQ</a><a href="/#contact">Contact</a>
            <a className="nav-proposal" href="/request-proposal">Request Proposal</a><a className="nav-cta" href="https://wa.me/60195193834" target="_blank" rel="noreferrer">WhatsApp</a>
          </nav>
          <MobileNav basePath="/" />
        </div>
      </header>

      <section className="services-hero" aria-labelledby="services-hero-title">
        <div className="container services-hero-grid">
          <div className="services-hero-copy"><span className="eyebrow">Our Services</span><h1 id="services-hero-title">Industrial Safety,<br />Technical Competency<br /><span>&amp; Workforce Solutions</span></h1><p>TERAS UNIVERSAL delivers competency-based industrial training, consultancy and workforce development solutions designed to improve safety, compliance and operational performance.</p><div className="hero-actions"><a className="btn btn-primary" href="/training">Explore Training</a><a className="btn btn-outline" href="/request-proposal">Request Proposal</a></div></div>
          <figure className="services-hero-media"><Image src="/images/temp-ai-corporate-scene-08.webp" alt="AI-generated industrial site inspection visual for presentation purposes." width={1200} height={800} priority sizes="(max-width: 920px) 100vw, 52vw" /><figcaption>AI-generated visual for presentation purposes.</figcaption></figure>
        </div>
      </section>

      <section className="services-standard-section"><div className="container services-standard-grid"><div><span className="eyebrow">The Standard of Competence</span><h2>Safety. Competency. Compliance. Continuous Improvement.</h2></div><div><p>We connect practical industrial training with the operational realities of the organisations we support.</p><p>Our approach is designed to help people understand risk, apply safe and competent work practices, meet defined requirements and keep improving performance over time.</p></div></div></section>

      <section className="services-pillars-section" aria-labelledby="pillars-title"><div className="container"><div className="section-heading services-section-heading"><span className="eyebrow">Four Core Service Pillars</span><h2 id="pillars-title">Integrated capability for safer and stronger operations.</h2><p>Explore the service areas that bring our training, consultancy and workforce solutions together.</p></div><div className="services-pillar-grid">{pillars.map(([number, title, text, tags, outcome, href]) => <article className="services-pillar-card" key={title}><div className="services-pillar-top"><span>{number}</span><small>CORE PILLAR</small></div><h3>{title}</h3><p>{text}</p><div className="services-tags">{tags.map((tag) => <span key={tag}>{tag}</span>)}</div><div className="services-outcome"><small>BUSINESS OUTCOME</small><strong>{outcome}</strong></div><a href={href}>Learn More <span aria-hidden="true">&rarr;</span></a></article>)}</div></div></section>

      <section className="service-detail-section"><div className="container">{serviceDetails.map(([id, title, text, tags, image], index) => <article id={id} className={`service-detail ${index % 2 ? "service-detail-reverse" : ""}`} key={id}><div className="service-detail-copy"><span className="eyebrow">0{index + 1} · {title}</span><h2>{title}</h2><p>{text}</p><ul>{tags.map((tag) => <li key={tag}>{tag}</li>)}</ul><div className="service-detail-outcome"><small>BUSINESS OUTCOME</small><strong>{serviceOutcomes[id]}</strong></div><a className="btn btn-primary" href="/#contact">Discuss This Service</a></div><figure className="service-detail-media"><Image src={image} alt="AI-generated industrial training visual for presentation purposes." width={1100} height={760} sizes="(max-width: 920px) 100vw, 50vw" /><figcaption>AI-generated visual for presentation purposes.</figcaption></figure></article>)}</div></section>

      <section className="services-process-section" aria-labelledby="services-process-title"><div className="container"><div className="section-heading"><span className="eyebrow">Service Delivery Process</span><h2 id="services-process-title">A disciplined route from need to improvement.</h2></div><div className="services-process-grid">{process.map((stage, index) => <article key={stage}><span>0{index + 1}</span><h3>{stage}</h3></article>)}</div></div></section>

      <section className="services-industries-section" aria-labelledby="services-industries-title"><div className="container"><div className="section-heading"><span className="eyebrow">Industries Supported</span><h2 id="services-industries-title">Built for safety-critical environments.</h2></div><div className="services-industries-grid">{industries.map((industry, index) => <article key={industry}><span>0{index + 1}</span><h3>{industry}</h3></article>)}</div></div></section>

      <section className="services-cta"><div className="container"><div><span className="eyebrow">Corporate &amp; Custom Solutions</span><h2>Let&apos;s Build a Safer and More Competent Workforce</h2></div><div className="hero-actions"><a className="btn btn-light" href="/request-proposal">Request Proposal</a><a className="btn btn-gold" href="https://wa.me/60195193834" target="_blank" rel="noreferrer">WhatsApp Us</a></div></div></section>

      <footer><div className="container footer-grid"><div className="footer-brand"><Image src="/teras-universal-logo.png" alt="TERAS UNIVERSAL" width={210} height={135} sizes="190px" /><p>Building Competence. Creating Opportunities.</p></div><div><h3>Core Services</h3><p>Industrial Safety<br />Technical Competency<br />Industrial Consultancy<br />Workforce Development</p></div><div><h3>Contact</h3><p><a href="mailto:training@terasuniversal.com.my">training@terasuniversal.com.my</a><br /><a href="tel:+60195193834">+60 19-519 3834</a></p><p>Lot 1961, Jalan Tanah Merah,<br />Kg Tanah Merah Dalam,<br />06000 Jitra, Kedah, Malaysia</p></div></div><div className="container footer-bottom"><span>&copy; 2026 TERAS UNIVERSAL SDN. BHD. All rights reserved.</span><span>terasuniversal.com.my</span></div></footer>
    </main>
  );
}
