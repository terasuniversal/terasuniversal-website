import Footer from "../../components/Footer";
import CardGrid from "../../components/premium/CardGrid";
import CtaBand from "../../components/premium/CtaBand";
import InnerHero from "../../components/premium/InnerHero";
import Outline from "../../components/premium/Outline";
import PremiumHeader from "../../components/premium/PremiumHeader";
import SectionHead from "../../components/premium/SectionHead";
import Timeline from "../../components/premium/Timeline";
import kit from "../../components/premium/premium.module.css";
import inner from "../../components/premium/inner.module.css";
import { coreValues, leadership, accreditations, timeline, trainingFacilities, partners } from "../../data/companyProfile";

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
    <>
      <PremiumHeader />
      <main className={`${kit.px} ${inner.page}`}>
        <InnerHero
          titleId="about-hero-title"
          eyebrow="About TERAS Universal"
          title="Building Competence. Creating Opportunities."
          lead="TERAS UNIVERSAL delivers competency-based industrial safety training, technical competency development, consultancy and workforce capability solutions designed to help organisations operate more safely, efficiently and confidently."
          actions={<div className={inner.actions}><a className={kit.btn} href="/training">Explore Training</a><a className={`${kit.btn} ${kit.btnLight}`} href="/#contact">Contact Us</a></div>}
        />

        <section className={kit.sec} aria-labelledby="story-title">
          <div className={`${kit.wrap} ${inner.twoCol}`}>
            <div className={inner.statement}>
              <span className={`${inner.eyebrow} ${inner.onLight}`}>Our Story</span>
              <h2 id="story-title">Practical capability for the work that matters.</h2>
            </div>
            <div className={inner.statement}>
              <p>TERAS UNIVERSAL was established to help organisations develop safer, more capable and more confident workforces through learning that connects directly to the workplace.</p>
              <p>Our focus is practical industrial learning: clear knowledge, guided application, structured assessment and solutions that reflect the needs of people, projects and operations.</p>
              <p>We aim to build long-term partnerships with organisations by listening carefully, delivering responsibly and continuously improving the way capability is developed.</p>
            </div>
          </div>
        </section>

        <section className={`${kit.sec} ${kit.trust}`} aria-labelledby="accred-title">
          <div className={kit.wrap}>
            <SectionHead id="accred-title" eyebrow="Recognition & Accreditations" title="Registered and recognised by Malaysia's governing bodies." />
            <CardGrid label="Recognition and accreditations" items={accreditations.map((a) => ({ label: a.org, title: a.label, text: a.text }))} />
          </div>
        </section>

        <section className={kit.sec} aria-labelledby="vision-title">
          <div className={kit.wrap}>
            <SectionHead id="vision-title" eyebrow="Direction & Purpose" title="A clear direction for meaningful workforce development." />
            <CardGrid label="Vision and mission" items={[{ label: "01", title: "Vision", text: "To be a trusted partner in building safer, more competent and more resilient workforces." }, { label: "02", title: "Mission", text: "To deliver practical, competency-based training and industrial solutions that help organisations strengthen people, performance and workplace confidence." }]} />
          </div>
        </section>

        <section className={`${kit.sec} ${kit.trust}`} aria-labelledby="values-title">
          <div className={kit.wrap}>
            <SectionHead id="values-title" eyebrow="TERAS Values" title="The principles behind every engagement." />
            <CardGrid label="TERAS values" items={coreValues.map((v) => ({ label: v.letter, title: v.title, meta: v.subtitle, text: v.text }))} />
          </div>
        </section>

        <section className={kit.sec} aria-labelledby="leadership-title">
          <div className={kit.wrap}>
            <SectionHead id="leadership-title" eyebrow="Our Leadership" title="Led by industry practitioners, not just administrators." />
            <CardGrid label="Leadership" items={leadership.map((p) => ({ label: p.role, title: p.name, meta: p.credential, text: p.bio, tags: p.focusAreas }))} />
          </div>
        </section>

        <section className={`${kit.sec} ${kit.trust}`} aria-labelledby="timeline-title">
          <div className={kit.wrap}>
            <SectionHead id="timeline-title" eyebrow="Our Journey" title="From the scaffold to founding TERAS UNIVERSAL." />
            <Timeline items={timeline} label="Director career and company timeline" />
          </div>
        </section>

        <section className={kit.sec} aria-labelledby="about-facilities-title">
          <div className={kit.wrap}>
            <SectionHead id="about-facilities-title" eyebrow="Training Facilities & Participant Support" title="Everything a training programme needs, in one place." />
            <CardGrid label="Training facilities and participant support" items={trainingFacilities.map((f) => ({ title: f.title, text: f.text }))} />
          </div>
        </section>

        <section className={`${kit.sec} ${kit.trust}`} aria-labelledby="reasons-title">
          <div className={kit.wrap}>
            <SectionHead id="reasons-title" eyebrow="Why Organisations Choose TERAS" title="Capability built around real organisational needs." />
            <CardGrid label="Why organisations choose TERAS" items={reasons.map(([number, title, text]) => ({ label: number, title, text }))} />
          </div>
        </section>

        <section className={kit.sec} aria-labelledby="approach-title">
          <div className={kit.wrap}>
            <SectionHead id="approach-title" eyebrow="Our Approach" title="A disciplined path from understanding to improvement." />
            <Outline items={approach} label="Our approach, in order" />
          </div>
        </section>

        <section className={`${kit.sec} ${kit.trust}`} aria-labelledby="about-industries-title">
          <div className={kit.wrap}>
            <SectionHead id="about-industries-title" eyebrow="Industries We Support" title="Built for safety-critical environments." />
            <CardGrid label="Industries we support" items={industries.map((name) => ({ title: name }))} />
          </div>
        </section>

        <section className={kit.sec} aria-labelledby="about-partners-title">
          <div className={kit.wrap}>
            <SectionHead id="about-partners-title" eyebrow="Strategic Partners" title="Organisations we collaborate with." />
            <CardGrid label="Strategic partners" items={partners.map((partner) => ({ title: partner.name, text: partner.text }))} />
            <p className={inner.note}>We also work with a wide range of corporate clients across Oil &amp; Gas, Construction, Manufacturing and other sectors. <a className={kit.tl} href="/industries">View industries we serve &rarr;</a></p>
          </div>
        </section>

        <section className={`${kit.sec} ${kit.trust}`} aria-labelledby="commitment-title">
          <div className={`${kit.wrap} ${inner.twoCol}`}>
            <div className={inner.statement}>
              <span className={`${inner.eyebrow} ${inner.onLight}`}>Corporate Commitment</span>
              <h2 id="commitment-title">Committed to Building Safer and More Competent Workforces</h2>
            </div>
            <div className={inner.statement}>
              <p>We work with organisations that value practical capability, responsible delivery and long-term improvement. Every engagement is an opportunity to help people perform with greater understanding, discipline and confidence.</p>
            </div>
          </div>
        </section>

        <CtaBand id="about-cta-title" eyebrow="Let's Work Together" title="Let's Build Capability Together">
          <a className={kit.btn} href="/request-proposal">Request Proposal</a>
          <a className={`${kit.btn} ${kit.btnLight}`} href="/contact">Contact Us</a>
        </CtaBand>
      </main>
      <Footer />
    </>
  );
}
