import Footer from "../../components/Footer";
import CardGrid from "../../components/premium/CardGrid";
import CtaBand from "../../components/premium/CtaBand";
import InnerHero from "../../components/premium/InnerHero";
import Outline from "../../components/premium/Outline";
import PremiumHeader from "../../components/premium/PremiumHeader";
import SectionHead from "../../components/premium/SectionHead";
import ServiceBlock from "../../components/premium/ServiceBlock";
import kit from "../../components/premium/premium.module.css";
import inner from "../../components/premium/inner.module.css";

// Pillar copy (short, for the index) and service copy (long, for the detail blocks) are the existing approved sentences.
// Scope lists and business outcomes were identical in both places, so they are shown once, in the detail block.
const pillars = [
  ["01", "Industrial Safety", "Strengthen hazard recognition, procedural discipline and safe task execution across safety-critical work environments.", "#safety"],
  ["02", "Technical Competency", "Build job-relevant technical capability through structured understanding, guided practice and practical assessment.", "#technical"],
  ["03", "Industrial Consultancy", "Translate operational risks and compliance gaps into practical review, advisory and improvement priorities.", "#consultancy"],
  ["04", "Workforce Development", "Align workforce capability with role requirements, project demands, organisational procedures and long-term development needs.", "#workforce"],
];
const serviceDetails = [
  ["safety", "Industrial Safety", "Practical safety learning designed around real workplace hazards, controls and task execution.", ["Working at Height", "Confined Space", "Scaffolding", "Safety Passport", "Lifting Awareness", "PPE"], "Safer execution and stronger workplace controls"],
  ["technical", "Technical Competency", "Structured technical development that connects knowledge, equipment familiarity, practical skills and competency requirements.", ["Machinery", "Equipment", "Inspection", "Practical Skills", "Competency Development"], "More capable and dependable technical teams"],
  ["consultancy", "Industrial Consultancy", "Practical advisory support to identify operational weaknesses, review controls and prioritise improvement actions.", ["Risk Assessment", "Safety Audit", "Site Inspection", "Compliance Review", "HSE Consultancy"], "Clearer controls and improved audit readiness"],
  ["workforce", "Workforce Development", "Role-focused programmes that help organisations build capability across teams, supervisors and workforce groups.", ["Corporate Training", "In-house Programme", "Competency Assessment", "Supervisor Development", "Foreign Worker Skills"], "A more prepared and adaptable workforce"],
];
const process = ["Need Analysis", "Planning", "Training", "Assessment", "Improvement"];
const industries = ["Oil & Gas", "Construction", "Manufacturing", "Petrochemical", "Marine", "Utilities", "Government"];

export default function ServicesPage() {
  return (
    <>
      <PremiumHeader />
      <main className={`${kit.px} ${inner.page}`}>
        <InnerHero
          titleId="services-hero-title"
          eyebrow="Our Services"
          title="Industrial Safety, Technical Competency & Workforce Solutions"
          lead="TERAS UNIVERSAL delivers competency-based industrial training, consultancy and workforce development solutions designed to improve safety, compliance and operational performance."
          actions={<div className={inner.actions}><a className={kit.btn} href="/training">Explore Training</a><a className={`${kit.btn} ${kit.btnLight}`} href="/request-proposal">Request Proposal</a></div>}
        />

        <section className={kit.sec} aria-labelledby="standard-title">
          <div className={`${kit.wrap} ${inner.twoCol}`}>
            <div className={inner.statement}>
              <span className={`${inner.eyebrow} ${inner.onLight}`}>The Standard of Competence</span>
              <h2 id="standard-title">Safety. Competency. Compliance. Continuous Improvement.</h2>
            </div>
            <div className={inner.statement}>
              <p>We connect practical industrial training with the operational realities of the organisations we support.</p>
              <p>Our approach is designed to help people understand risk, apply safe and competent work practices, meet defined requirements and keep improving performance over time.</p>
            </div>
          </div>
        </section>

        <section className={`${kit.sec} ${kit.trust}`} aria-labelledby="pillars-title">
          <div className={kit.wrap}>
            <SectionHead id="pillars-title" eyebrow="Four Core Service Pillars" title="Integrated capability for safer and stronger operations.">Explore the service areas that bring our training, consultancy and workforce solutions together.</SectionHead>
            <ul className={inner.tiles}>
              {pillars.map(([number, title, text, href]) => (
                <li className={`${inner.tile} ${inner.tilePlain}`} key={title}>
                  <span className={inner.cat}>{number} · Core pillar</span>
                  <h3><a className={inner.stretch} href={href}>{title}</a></h3>
                  <p>{text}</p>
                  <span className={inner.tileGo} aria-hidden="true">Learn More &rarr;</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {serviceDetails.map(([id, title, text, tags, outcome], index) => (
          <section className={`${kit.sec} ${index % 2 ? "" : kit.trust}`} key={id} aria-labelledby={`${id}-title`}>
            <div className={kit.wrap}>
              <ServiceBlock id={id} eyebrow={`0${index + 1} · ${title}`} title={title} text={text} items={tags} outcome={outcome} cta={{ href: "/#contact", label: "Discuss This Service" }} />
            </div>
          </section>
        ))}

        <section className={kit.sec} aria-labelledby="scaffolding-title">
          <div className={kit.wrap}>
            <ServiceBlock id="scaffolding" eyebrow="05 · Scaffolding Rental & Installation" title="Scaffolding Rental & Installation" text="Safe, reliable and professionally managed scaffolding solutions for construction, maintenance and industrial projects." items={["Scaffolding Rental", "Scaffolding Erection", "Scaffolding Dismantling", "Inspection & Maintenance"]} outcome="Safer, well-managed scaffolding for every project stage" cta={{ href: "/services/scaffolding", label: "View Scaffolding Services" }} />
          </div>
        </section>

        <section className={`${kit.sec} ${kit.trust}`} aria-labelledby="services-process-title">
          <div className={kit.wrap}>
            <SectionHead id="services-process-title" eyebrow="Service Delivery Process" title="A disciplined route from need to improvement." />
            <Outline items={process} label="Service delivery process, in order" />
          </div>
        </section>

        <section className={kit.sec} aria-labelledby="services-industries-title">
          <div className={kit.wrap}>
            <SectionHead id="services-industries-title" eyebrow="Industries Supported" title="Built for safety-critical environments." />
            <CardGrid label="Industries supported" items={industries.map((name) => ({ title: name }))} />
          </div>
        </section>

        <CtaBand id="services-cta-title" eyebrow="Corporate & Custom Solutions" title="Let's Build a Safer and More Competent Workforce">
          <a className={kit.btn} href="/request-proposal">Request Proposal</a>
          <a className={`${kit.btn} ${kit.btnLight}`} href="https://wa.me/60195193834" target="_blank" rel="noreferrer">WhatsApp Us<span className="sr-only"> (opens in a new tab)</span></a>
        </CtaBand>
      </main>
      <Footer />
    </>
  );
}
