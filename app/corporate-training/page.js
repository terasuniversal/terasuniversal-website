import Footer from "../../components/Footer";
import CardGrid from "../../components/premium/CardGrid";
import CtaBand from "../../components/premium/CtaBand";
import InnerHero from "../../components/premium/InnerHero";
import PremiumHeader from "../../components/premium/PremiumHeader";
import SectionHead from "../../components/premium/SectionHead";
import kit from "../../components/premium/premium.module.css";
import inner from "../../components/premium/inner.module.css";
import AccreditationGrid from "../../components/premium/AccreditationGrid";
import { accreditationRows } from "../../components/home/recognitionStatus";
import { confirmedFacts, leadership, partners } from "../../data/companyProfile";
import { industries } from "../../data/industries";

// The JKKP recognition shown on this page expires; re-render hourly so it flips on the day it ends.
export const revalidate = 3600;

export const metadata = { title: "Corporate Training", description: "Corporate, in-house and onsite industrial safety, technical competency and workforce development solutions from TERAS UNIVERSAL.", alternates: { canonical: "/corporate-training" }, openGraph: { title: "Corporate Training | TERAS UNIVERSAL", description: "Custom industrial safety, competency and workforce development solutions for Malaysian organisations.", url: "/corporate-training" } };

const pillars = [["Industrial Safety Training", "Practical learning designed around workplace hazards, controls and safe task execution."], ["Technical Competency Development", "Structured development that connects knowledge, guided practice and job-relevant capability."], ["Competency Assessment", "Theoretical and practical evaluation according to the requirements of the programme."], ["Industrial Consultancy", "Practical advisory support for organisations reviewing operational weaknesses and improvement priorities."], ["Corporate & In-House Training", "Programme scope and delivery arrangements shaped around one organisation or workforce group."], ["Workforce Development", "Role-focused development aligned with workforce, project and operational requirements."]];
const process = [["Understand Requirements", "Discuss workforce profile, operating environment, objectives and delivery needs."], ["Identify Capability Needs", "Clarify the relevant training, competency or assessment requirement."], ["Design the Arrangement", "Plan programme scope, delivery method, timing and practical requirements."], ["Deliver Training or Assessment", "Provide structured theory, practical learning or assessment as required."], ["Follow Up", "Record completion or certification where the programme requirements apply."]];
const delivery = [["Public Programme", "Scheduled learning for individuals and employees from different organisations."], ["Corporate In-House Training", "A focused programme arranged for one organisation or workforce group."], ["Onsite Training", "Practical learning delivered at a client workplace, plant, project site or approved facility."], ["Competency Assessment", "Structured theoretical and practical evaluation according to programme requirements."]];
const whatsappHref = "https://wa.me/60195193834?text=Hi%20TERAS%2C%20saya%20ingin%20bertanya%20tentang%20latihan%20korporat.";

export default function CorporateTrainingPage() {
  const director = leadership[0];
  // The profile JKKP line is only shown while the scoped JKKP recognition is current (same rule as the homepage).
  const jkkpCurrent = accreditationRows().find((row) => row.org.startsWith("JKKP"))?.current ?? false;
  const facts = confirmedFacts.slice(0, 4).filter((fact) => !fact.startsWith("JKKP") || jkkpCurrent);
  return <>
      <PremiumHeader />
      <main className={`${kit.px} ${inner.page}`}>
        <InnerHero
          titleId="corporate-training-title"
          eyebrow="Corporate Training"
          title="Build competence around your workforce and operating realities."
          lead="TERAS UNIVERSAL supports organisations with industrial safety training, technical competency development, consultancy and workforce solutions shaped around practical workplace needs."
          actions={<div className={inner.actions}><a className={kit.btn} href="/request-proposal?source=corporate-training">Request Corporate Training</a><a className={`${kit.btn} ${kit.btnLight}`} href={whatsappHref} target="_blank" rel="noreferrer">Talk to TERAS<span className="sr-only"> (opens in a new tab)</span></a></div>}
        />

        <section className={kit.sec} aria-labelledby="capability-title">
          <div className={`${kit.wrap} ${inner.twoCol}`}>
            <div className={inner.statement}>
              <span className={`${inner.eyebrow} ${inner.onLight}`}>Corporate Capability</span>
              <h2 id="capability-title">Training, assessment and advice that connect with the work.</h2>
            </div>
            <div className={inner.statement}>
              <p>Corporate arrangements can be shaped around workforce roles, operational requirements, participant profiles and preferred delivery methods.</p>
              <ul className={inner.tags} aria-label="TERAS UNIVERSAL credentials">{facts.map((fact) => <li key={fact}>{fact}</li>)}</ul>
            </div>
          </div>
        </section>

        <section className={`${kit.sec} ${kit.trust}`} aria-labelledby="solutions-title">
          <div className={kit.wrap}>
            <SectionHead id="solutions-title" eyebrow="Corporate Solutions" title="One conversation, relevant capability options.">Start with the requirement, then build the most suitable training, assessment or advisory arrangement.</SectionHead>
            <CardGrid label="Corporate solutions" items={pillars.map(([title, text]) => ({ title, text }))} />
          </div>
        </section>

        <section className={kit.sec} aria-labelledby="process-title">
          <div className={kit.wrap}>
            <SectionHead id="process-title" eyebrow="Customisation Process" title="A disciplined route from requirement to delivery." />
            <CardGrid label="Customisation process, in order" items={process.map(([title, text], index) => ({ label: `Step ${index + 1}`, title, text }))} />
          </div>
        </section>

        <section className={`${kit.sec} ${kit.band}`} aria-labelledby="delivery-title">
          <div className={kit.wrap}>
            <SectionHead id="delivery-title" eyebrow="Delivery Options" onNavy title="Arrange learning around the team and the workplace." />
            <ul className={inner.modes4}>{delivery.map(([title, text], index) => <li key={title}><span>{String(index + 1).padStart(2, "0")}</span><h3>{title}</h3><p>{text}</p></li>)}</ul>
          </div>
        </section>

        <section className={kit.sec} aria-labelledby="industries-title">
          <div className={kit.wrap}>
            <SectionHead id="industries-title" eyebrow="Industries Served" title="Relevant for safety-critical operations.">Explore the sector context, relevant programmes and corporate enquiry path for the industries TERAS supports.</SectionHead>
            <ul className={inner.tiles}>
              {industries.map((industry) => (
                <li className={`${inner.tile} ${inner.tilePlain}`} key={industry.slug}>
                  <span className={inner.cat}>Industry</span>
                  <h3><a className={inner.stretch} href={`/industries/${industry.slug}`}>{industry.name}</a></h3>
                  <p>{industry.summary}</p>
                  <span className={inner.tileGo} aria-hidden="true">View industry solutions &rarr;</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className={`${kit.sec} ${kit.trust}`} aria-labelledby="why-title">
          <div className={kit.wrap}>
            <SectionHead id="why-title" eyebrow="Why TERAS" title="Verified credentials for corporate conversations." />
            <AccreditationGrid label="Credentials" />
          </div>
        </section>

        <section className={kit.sec} aria-labelledby="experience-title">
          <div className={kit.wrap}>
            <SectionHead id="experience-title" eyebrow="Industry Experience" title="Leadership grounded in industrial practice." />
            <ul className={inner.proof}>
              <li><span className={inner.cat}>Established</span><strong>2012</strong><p>TERAS UNIVERSAL has been incorporated since 2012.</p></li>
              {director && <li><span className={inner.cat}>{director.role}</span><strong>{director.name}</strong><p>{director.credential || "Industry training and competency background."}</p></li>}
              <li><span className={inner.cat}>Certificate Verification</span><strong>Verify issued certificates</strong><p><a className={kit.tl} href="/verify">Use the TERAS public certificate verification page &rarr;</a></p></li>
            </ul>
          </div>
        </section>

        {partners.length > 0 && (
          <section className={`${kit.sec} ${kit.trust}`} aria-labelledby="partners-title">
            <div className={kit.wrap}>
              <SectionHead id="partners-title" eyebrow="Approved Partner References" title="Organisations TERAS collaborates with." />
              <CardGrid label="Partner references" items={partners.map((partner) => ({ title: partner.name, text: partner.text }))} />
            </div>
          </section>
        )}

        <CtaBand id="corporate-cta-title" eyebrow="Corporate & Custom Solutions" title="Ready to discuss your workforce requirements?" text="Share your operating context, workforce needs and preferred arrangement. TERAS will use that as the starting point for the conversation.">
          <a className={kit.btn} href="/request-proposal?source=corporate-training-final">Request Corporate Training</a>
          <a className={`${kit.btn} ${kit.btnLight}`} href={whatsappHref} target="_blank" rel="noreferrer">Talk to TERAS<span className="sr-only"> (opens in a new tab)</span></a>
        </CtaBand>
      </main>
      <Footer />
    </>;
}
