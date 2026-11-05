import Footer from "../../../components/Footer";
import Recognition from "../../../components/home/Recognition";
import CtaBand from "../../../components/premium/CtaBand";
import InnerHero from "../../../components/premium/InnerHero";
import Outline from "../../../components/premium/Outline";
import PremiumHeader from "../../../components/premium/PremiumHeader";
import SectionHead from "../../../components/premium/SectionHead";
import kit from "../../../components/premium/premium.module.css";
import inner from "../../../components/premium/inner.module.css";

// The JKKP recognition shown in the Recognition block expires; re-render hourly so it flips on the day it ends.
export const revalidate = 3600;

const objectives = ["Understand fundamental scaffolding terminology and components.", "Recognise common scaffolding hazards and unsafe conditions.", "Understand basic safe erection and dismantling principles.", "Apply relevant workplace safety responsibilities.", "Identify inspection and reporting considerations.", "Demonstrate improved task awareness and procedural discipline."];
const modules = ["Introduction to Scaffolding", "Scaffold Components and Terminology", "Roles and Responsibilities", "Hazard Identification", "Safe Erection and Dismantling Principles", "Access, Platforms and Guardrails", "PPE and Fall Protection Awareness", "Basic Inspection Awareness", "Practical Demonstration", "Assessment and Programme Review"];
const participants = ["Scaffolders", "Supervisors", "Safety personnel", "Construction workers", "Maintenance teams", "Industrial workforce personnel"];
const delivery = [["01", "Public Programme"], ["02", "Corporate In-House"], ["03", "Onsite Training"], ["04", "Practical Assessment"]];
const methodology = ["Need Analysis", "Theory", "Demonstration", "Guided Practical", "Assessment", "Feedback"];
const faqs = [["Is this programme suitable for beginners?", "Selected programme arrangements may be suitable for beginners, subject to participant profiles, programme requirements and any applicable entry considerations."], ["Can training be conducted at our site?", "Selected programmes may be delivered onsite, subject to programme requirements, site suitability, equipment availability and safety arrangements."], ["Is practical training included?", "Where applicable, the programme combines theory, demonstrations, guided practical exercises and structured assessment."], ["Do participants receive a certificate?", "Certification or proof of completion is subject to attendance, programme structure, assessment requirements and applicable competency criteria."], ["Can the programme be customised?", "Training scope may be adapted according to participant profiles, operational risks, organisational procedures and desired learning outcomes."], ["How can we request a quotation?", "Submit the website enquiry form, contact TERAS UNIVERSAL through WhatsApp or email training@terasuniversal.com.my."]];

export default function ScaffoldingCompetencyPage() {
  return (
    <>
      <PremiumHeader />
      <main className={`${kit.px} ${inner.page}`}>
      <InnerHero
        titleId="course-hero-title"
        crumbs={[{ label: "Home", href: "/" }, { label: "Training", href: "/training" }, { label: "Scaffolding Competency" }]}
        eyebrow="Industrial Safety Training"
        title="Scaffolding Competency Training"
        lead="A structured training pathway designed to strengthen scaffolding knowledge, hazard awareness, safe work practices and practical task discipline."
        actions={<div className={inner.actions}><a className={kit.btn} href="/contact">Request Course Information</a><a className={`${kit.btn} ${kit.btnLight}`} href="https://wa.me/60195193834" target="_blank" rel="noreferrer">WhatsApp Our Team<span className="sr-only"> (opens in a new tab)</span></a></div>}
      />

      <section className={kit.sec} aria-labelledby="overview-title"><div className={kit.wrap}><SectionHead id="overview-title" eyebrow="Course Overview" title="Build Safer Scaffolding Capability">This programme introduces essential scaffolding principles, workplace hazards, safe-use requirements and practical awareness for personnel involved in scaffolding-related activities.</SectionHead><ul className={inner.points}>{["Competency-Based Learning", "Theory and Practical Application", "Workplace Safety Focus", "Flexible Delivery Options"].map((title) => <li key={title}><h3>{title}</h3></li>)}</ul></div></section>

      <section className={`${kit.sec} ${kit.trust}`} aria-labelledby="objectives-title"><div className={`${kit.wrap} ${inner.twoCol}`}><div><span className={`${inner.eyebrow} ${inner.onLight}`}>Learning Objectives</span><h2 id="objectives-title">Participants should be able to:</h2></div><Outline items={objectives} check label="Learning objectives" /></div></section>

      <section className={kit.sec} aria-labelledby="content-title"><div className={kit.wrap}><SectionHead id="content-title" eyebrow="Course Content" title="A structured learning pathway." /><Outline items={modules} label="Course content" /></div></section>

      <section className={`${kit.sec} ${kit.trust}`} aria-labelledby="participants-title"><div className={`${kit.wrap} ${inner.twoCol}`}><div><span className={`${inner.eyebrow} ${inner.onLight}`}>Suitable Participants</span><h2 id="participants-title">Relevant to teams involved in scaffolding-related work.</h2></div><ul className={inner.aside}>{participants.map((item) => <li key={item}>{item}</li>)}</ul></div></section>

      <section className={kit.sec} aria-labelledby="delivery-title"><div className={kit.wrap}><SectionHead id="delivery-title" eyebrow="Delivery Options" title="Flexible arrangements for different workforce needs." /><ul className={inner.points}>{delivery.map(([, title]) => <li key={title}><h3>{title}</h3></li>)}</ul><p className={inner.note}>Delivery arrangements are subject to programme requirements, site suitability, equipment availability and participant profiles.</p></div></section>

      <section className={`${kit.sec} ${kit.trust}`} aria-labelledby="method-title"><div className={kit.wrap}><SectionHead id="method-title" eyebrow="Training Methodology" title="From need analysis to feedback." /><Outline items={methodology} label="Training methodology, in order" /></div></section>

      <section className={kit.sec} aria-labelledby="certification-title"><div className={`${kit.wrap} ${inner.twoCol}`}><div><span className={`${inner.eyebrow} ${inner.onLight}`}>Certification Note</span><h2 id="certification-title">Completion is subject to programme requirements.</h2></div><p>Certification or proof of completion is subject to attendance, programme structure, assessment requirements and applicable competency criteria.</p></div></section>

      <section id="course-faq" className={`${kit.sec} ${kit.trust}`} aria-labelledby="course-faq-title"><div className={`${kit.wrap} ${kit.faq}`}><div><span className={`${inner.eyebrow} ${inner.onLight}`}>Frequently Asked Questions</span><h2 id="course-faq-title">Questions about this programme.</h2></div><div>{faqs.map(([question, answer]) => <details className={kit.q} key={question}><summary>{question}</summary><p>{answer}</p></details>)}</div></div></section>

      <Recognition />

      <CtaBand id="course-cta-title" eyebrow="Corporate Training Solutions" title="Planning Scaffolding Training for Your Workforce?" text="Speak with TERAS UNIVERSAL about participant requirements, delivery arrangements and a customised corporate proposal.">
        <a className={kit.btn} href="/request-proposal">Request Proposal</a>
        <a className={`${kit.btn} ${kit.btnLight}`} href="https://wa.me/60195193834" target="_blank" rel="noreferrer">WhatsApp Our Team<span className="sr-only"> (opens in a new tab)</span></a>
      </CtaBand>
      </main>
      <Footer />
    </>
  );
}
