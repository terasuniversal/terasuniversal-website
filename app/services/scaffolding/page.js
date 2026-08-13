import Image from "next/image";
import MobileNav from "../../../components/MobileNav";
import MegaNav from "../../../components/MegaNav";
import Footer from "../../../components/Footer";

const WHATSAPP_MESSAGE = "Hi TERAS UNIVERSAL, I would like to enquire about your Scaffolding Rental & Installation service.";
const whatsappHref = `https://wa.me/60195193834?text=${encodeURIComponent(WHATSAPP_MESSAGE)}`;

const services = [
  ["RT", "Scaffolding Rental", ["Short-term and long-term rental", "Suitable for various project requirements"]],
  ["ER", "Scaffolding Erection", ["Installation by experienced and competent personnel", "Safe and systematic erection process"]],
  ["DM", "Scaffolding Dismantling", ["Controlled and systematic dismantling", "Focus on safety and site organisation"]],
  ["IM", "Inspection & Maintenance", ["Periodic scaffolding inspection", "Maintenance to support safe continued use", "Compliance-focused documentation where applicable"]],
];
const types = [["TF", "Tube & Fitting"], ["RL", "Ringlock"], ["CL", "Cuplock"], ["FR", "Frame Scaffolding"], ["SY", "System Scaffolding"]];
const reasons = [
  ["Experienced Personnel", "Scaffolding work carried out by experienced and competent personnel."],
  ["Quality Equipment", "Quality and properly maintained scaffolding equipment for every project."],
  ["Safety & Compliance Focused", "Work carried out in accordance with applicable project and safety requirements."],
  ["Professional Service", "Professional and efficient service from enquiry through to project completion."],
  ["Complete Documentation", "Complete documentation and project support throughout the engagement."],
];

export default function ScaffoldingServicePage() {
  return (
    <main className="scaffolding-page">
      <header className="site-header"><div className="container nav-wrap"><a className="brand" href="/" aria-label="TERAS UNIVERSAL home"><Image src="/teras-universal-logo.png" alt="TERAS UNIVERSAL logo" width={220} height={140} priority sizes="154px" /></a><MegaNav /><MobileNav basePath="/" /></div></header>

      <section className="scaffolding-hero" aria-labelledby="scaffolding-hero-title"><div className="container"><nav className="course-breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a><span>/</span><a href="/services">Services</a><span>/</span><span aria-current="page">Scaffolding Rental &amp; Installation</span></nav><div className="scaffolding-hero-grid"><div className="scaffolding-hero-copy"><span className="eyebrow">Scaffolding Rental &amp; Installation</span><h1 id="scaffolding-hero-title">Safe, Reliable Scaffolding Solutions</h1><p>Rental, erection, dismantling, inspection and maintenance support for construction and industrial projects.</p><div className="hero-actions"><a className="btn btn-primary" href="/request-proposal">Request a Quotation</a><a className="btn btn-outline" href={whatsappHref} target="_blank" rel="noreferrer">WhatsApp Us</a></div></div><figure className="scaffolding-hero-media"><Image src="/images/scaffolding-rental-poster-en.webp" alt="TERAS UNIVERSAL Scaffolding Rental and Installation Services" width={853} height={1280} priority sizes="(max-width: 920px) 260px, 340px" /></figure></div></div></section>

      <section className="scaffolding-overview-section" aria-labelledby="overview-title"><div className="container"><div className="section-heading"><span className="eyebrow">Service Overview</span><h2 id="overview-title">Scaffolding Support for Every Project Stage</h2><p>TERAS UNIVERSAL provides scaffolding rental and installation services for construction, maintenance and industrial projects, covering short and long-term rental, erection, dismantling, and ongoing inspection and maintenance support.</p><p className="scaffolding-overview-text">Our teams work in a structured and systematic manner from the initial site assessment through to dismantling, with safety and site organisation as an ongoing priority throughout the engagement.</p></div></div></section>

      <section className="scaffolding-services-section" aria-labelledby="scaffolding-services-title"><div className="container"><div className="section-heading"><span className="eyebrow">Our Scaffolding Services</span><h2 id="scaffolding-services-title">A complete scaffolding service, start to finish.</h2></div><div className="scaffolding-service-grid">{services.map(([code, title, points]) => <article className="scaffolding-service-card" key={title}><span aria-hidden="true">{code}</span><h3>{title}</h3><ul>{points.map((point) => <li key={point}>{point}</li>)}</ul></article>)}</div></div></section>

      <section className="scaffolding-types-section" aria-labelledby="scaffolding-types-title"><div className="container"><div className="section-heading"><span className="eyebrow">Types of Scaffolding</span><h2 id="scaffolding-types-title">Scaffolding systems for different project needs.</h2></div><div className="scaffolding-type-grid">{types.map(([code, title]) => <article className="scaffolding-type-card" key={title}><span aria-hidden="true">{code}</span><h3>{title}</h3></article>)}</div></div></section>

      <section className="why-section" aria-labelledby="scaffolding-why-title"><div className="container"><div className="section-heading why-heading"><span className="eyebrow">Why Choose TERAS UNIVERSAL</span><h2 id="scaffolding-why-title">Built on safety, quality and reliability.</h2></div><div className="reason-grid">{reasons.map(([title, text], index) => <article key={title}><span className="reason-icon" aria-hidden="true">{["EX", "QE", "SC", "PS", "CD"][index]}</span><div><h3>{title}</h3><p>{text}</p></div></article>)}</div></div></section>

      <section className="scaffolding-poster-section" aria-labelledby="scaffolding-poster-title"><div className="container scaffolding-poster-grid"><figure className="scaffolding-poster-media"><Image src="/images/scaffolding-rental-poster-en.webp" alt="TERAS UNIVERSAL Scaffolding Rental and Installation Services" width={853} height={1280} sizes="(max-width: 920px) 260px, 340px" /></figure><div className="scaffolding-poster-copy"><span className="eyebrow">TERAS UNIVERSAL Scaffolding</span><h2 id="scaffolding-poster-title">Scaffolding Solutions You Can Rely On</h2><p>Safe, reliable and professionally managed scaffolding solutions for construction, maintenance and industrial projects. Reach out to discuss your rental duration, scaffolding type and site requirements.</p><div className="hero-actions"><a className="btn btn-gold" href="/request-proposal">Request a Quotation</a><a className="btn btn-light" href={whatsappHref} target="_blank" rel="noreferrer">Enquire About Scaffolding</a></div><p className="scaffolding-poster-phone">Call or WhatsApp: <a href="tel:+60195193834">019-519 3834</a></p></div></div></section>

      <section className="course-final-cta"><div className="container"><div><span className="eyebrow">Scaffolding Enquiries</span><h2>Need Scaffolding for Your Next Project?</h2><p>Talk to TERAS UNIVERSAL about your project requirements, rental duration and site needs.</p></div><div className="hero-actions"><a className="btn btn-gold" href="/request-proposal">Request a Quotation</a><a className="btn btn-light" href={whatsappHref} target="_blank" rel="noreferrer">WhatsApp 019-519 3834</a></div></div></section>

      <Footer />
    </main>
  );
}
