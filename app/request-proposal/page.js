import Image from "next/image";
import MobileNav from "../../components/MobileNav";
import ProposalWizard from "../../components/ProposalWizard";
import Footer from "../../components/Footer";

const benefits = [
  ["01", "Customised Solutions", "A proposal shaped around your workforce profile, operational requirements and delivery preferences."],
  ["02", "Fast Response", "A clear starting point for discussing the scope, participants and priorities behind your request."],
  ["03", "Industry Experience", "Practical conversations across industrial safety, technical competency, consultancy and workforce development."],
  ["04", "Nationwide Delivery", "Flexible arrangements for organisations operating across Malaysia."],
];
const process = ["Submit Request", "Review", "Consultation", "Proposal", "Training Delivery"];

export default function RequestProposalPage() {
  return (
    <main className="proposal-page">
      <header className="site-header"><div className="container nav-wrap"><a className="brand" href="/" aria-label="TERAS UNIVERSAL home"><Image src="/teras-universal-logo.png" alt="TERAS UNIVERSAL logo" width={220} height={140} priority sizes="154px" /></a><nav className="desktop-nav" aria-label="Main navigation"><a href="/about">About</a><a href="/services">Services</a><a href="/training">Training</a><a href="/#industries">Industries</a><a href="/#faq">FAQ</a><a href="/contact">Contact</a><br /><a href="/verify">Verify Certificate</a><a className="nav-proposal" href="/request-proposal">Request Proposal</a><a className="nav-cta" href="https://wa.me/60195193834" target="_blank" rel="noreferrer">WhatsApp</a></nav><MobileNav basePath="/" /></div></header>

      <section className="proposal-hero" aria-labelledby="proposal-hero-title"><div className="container proposal-hero-grid"><div className="proposal-hero-copy"><span className="eyebrow">Request a Proposal</span><h1 id="proposal-hero-title">Tell Us About Your Training Requirements</h1><p>Share your organisation&apos;s training needs and our team will prepare a suitable proposal based on your workforce, operational requirements and preferred delivery method.</p><div className="hero-actions"><a className="btn btn-primary" href="https://wa.me/60195193834" target="_blank" rel="noreferrer">WhatsApp Us</a><a className="btn btn-outline" href="/training">Explore Training</a></div></div><figure className="proposal-hero-media"><Image src="/images/temp-ai-corporate-scene-11.webp" alt="Industrial consultant discussing training requirements with a corporate client." width={1200} height={800} priority sizes="(max-width: 920px) 100vw, 52vw" /></figure></div></section>

      <section className="proposal-form-section" aria-labelledby="proposal-form-title"><div className="container"><div className="section-heading proposal-section-heading"><span className="eyebrow">Corporate Enquiry Form</span><h2 id="proposal-form-title">Help us understand your requirements.</h2><p>Complete the form and we can use the information as a starting point for the next conversation.</p></div><ProposalWizard /></div></section>

      <section className="proposal-benefits-section" aria-labelledby="benefits-title"><div className="container"><div className="section-heading"><span className="eyebrow">Why Submit a Proposal Request</span><h2 id="benefits-title">A clearer route to the right arrangement.</h2></div><div className="proposal-benefits-grid">{benefits.map(([number,title,text]) => <article key={title}><span>{number}</span><h3>{title}</h3><p>{text}</p></article>)}</div></div></section>

      <section className="proposal-process-section" aria-labelledby="proposal-process-title"><div className="container"><div className="section-heading"><span className="eyebrow">Our Process</span><h2 id="proposal-process-title">From request to delivery.</h2></div><div className="proposal-process-grid">{process.map((stage,index) => <article key={stage}><span>{String(index+1).padStart(2,"0")}</span><h3>{stage}</h3>{index < process.length - 1 && <b aria-hidden="true">&rarr;</b>}</article>)}</div></div></section>

      <section className="proposal-assistance-section"><div className="container"><div><span className="eyebrow">Corporate Assistance</span><h2>Need Immediate Assistance?</h2></div><div className="hero-actions"><a className="btn btn-light" href="https://wa.me/60195193834" target="_blank" rel="noreferrer">WhatsApp</a><a className="btn btn-gold" href="tel:+60195193834">Call</a><a className="btn btn-outline proposal-email-button" href="mailto:training@terasuniversal.com.my">Email</a></div></div></section>

      <Footer />
    </main>
  );
}
