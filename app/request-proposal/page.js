import Image from "next/image";
import PremiumHeader from "../../components/premium/PremiumHeader";
import ProposalWizard from "../../components/ProposalWizard";
import PremiumFooter from "../../components/premium/PremiumFooter";
import { publicBody } from "../../components/premium/fonts";
import bridge from "../../components/premium/legacy-bridge.module.css";

const benefits = [
  ["01", "Customised Solutions", "A proposal shaped around your workforce profile, operational requirements and delivery preferences."],
  ["02", "Fast Response", "A clear starting point for discussing the scope, participants and priorities behind your request."],
  ["03", "Industry Experience", "Practical conversations across industrial safety, technical competency, consultancy and workforce development."],
  ["04", "Nationwide Delivery", "Flexible arrangements for organisations operating across Malaysia."],
];
const process = ["Submit Request", "Review", "Consultation", "Proposal", "Training Delivery"];

// Phase S4D-2C: the shared Premium header replaces the page's own legacy header and, as on the other Premium
// pages, sits before <main> rather than inside it. Everything inside <main> is unchanged.
export default function RequestProposalPage() {
  return (
    <>
    <PremiumHeader />
    <main className={`proposal-page ${bridge.page} ${publicBody.variable}`}>

      <section className="proposal-hero" aria-labelledby="proposal-hero-title"><div className="container proposal-hero-grid"><div className="proposal-hero-copy"><span className="eyebrow">Request a Proposal</span><h1 id="proposal-hero-title">Tell Us About Your Training Requirements</h1><p>Share your organisation&apos;s training needs and our team will prepare a suitable proposal based on your workforce, operational requirements and preferred delivery method.</p><div className="hero-actions"><a className="btn btn-primary" href="https://wa.me/60195193834" target="_blank" rel="noreferrer">WhatsApp Us</a><a className="btn btn-outline" href="/training">Explore Training</a></div></div><figure className="proposal-hero-media"><Image src="/images/v2/panel-c.svg" alt="" unoptimized width={1200} height={800} priority sizes="(max-width: 920px) 100vw, 52vw" /></figure></div></section>

      <section className="proposal-form-section" aria-labelledby="proposal-form-title"><div className="container"><div className="section-heading proposal-section-heading"><span className="eyebrow">Corporate Enquiry Form</span><h2 id="proposal-form-title">Help us understand your requirements.</h2><p>Complete the form and we can use the information as a starting point for the next conversation.</p></div><ProposalWizard /></div></section>

      <section className="proposal-benefits-section" aria-labelledby="benefits-title"><div className="container"><div className="section-heading"><span className="eyebrow">Why Submit a Proposal Request</span><h2 id="benefits-title">A clearer route to the right arrangement.</h2></div><div className="proposal-benefits-grid">{benefits.map(([number,title,text]) => <article key={title}><span>{number}</span><h3>{title}</h3><p>{text}</p></article>)}</div></div></section>

      <section className="proposal-process-section" aria-labelledby="proposal-process-title"><div className="container"><div className="section-heading"><span className="eyebrow">Our Process</span><h2 id="proposal-process-title">From request to delivery.</h2></div><div className="proposal-process-grid">{process.map((stage,index) => <article key={stage}><span>{String(index+1).padStart(2,"0")}</span><h3>{stage}</h3>{index < process.length - 1 && <b aria-hidden="true">&rarr;</b>}</article>)}</div></div></section>

      <section className="proposal-assistance-section"><div className="container"><div><span className="eyebrow">Corporate Assistance</span><h2>Need Immediate Assistance?</h2></div><div className="hero-actions"><a className="btn btn-primary" href="https://wa.me/60195193834" target="_blank" rel="noreferrer">WhatsApp</a><a className="btn btn-outline" href="tel:+60195193834">Call</a><a className="btn btn-outline proposal-email-button" href="mailto:admin@terasuniversal.com.my">Email</a></div></div></section>
    </main>

      <PremiumFooter />
    </>
  );
}
