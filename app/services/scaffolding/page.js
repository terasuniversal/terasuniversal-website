import Footer from "../../../components/Footer";
import CardGrid from "../../../components/premium/CardGrid";
import CtaBand from "../../../components/premium/CtaBand";
import InnerHero from "../../../components/premium/InnerHero";
import PremiumHeader from "../../../components/premium/PremiumHeader";
import SectionHead from "../../../components/premium/SectionHead";
import BreadcrumbJsonLd from "../../../components/public/BreadcrumbJsonLd";
import kit from "../../../components/premium/premium.module.css";
import inner from "../../../components/premium/inner.module.css";

const WHATSAPP_MESSAGE = "Hi TERAS UNIVERSAL, I would like to enquire about your Scaffolding Rental & Installation service.";
const whatsappHref = `https://wa.me/60195193834?text=${encodeURIComponent(WHATSAPP_MESSAGE)}`;

const services = [
  { title: "Scaffolding Rental", points: ["Short-term and long-term rental", "Suitable for various project requirements"] },
  { title: "Scaffolding Erection", points: ["Installation by experienced and competent personnel", "Safe and systematic erection process"] },
  { title: "Scaffolding Dismantling", points: ["Controlled and systematic dismantling", "Focus on safety and site organisation"] },
  { title: "Inspection & Maintenance", points: ["Periodic scaffolding inspection", "Maintenance to support safe continued use", "Compliance-focused documentation where applicable"] },
];
const types = ["Tube & Fitting", "Ringlock", "Cuplock", "Frame Scaffolding", "System Scaffolding"];
const reasons = [
  ["Experienced Personnel", "Scaffolding work carried out by experienced and competent personnel."],
  ["Quality Equipment", "Quality and properly maintained scaffolding equipment for every project."],
  ["Safety & Compliance Focused", "Work carried out in accordance with applicable project and safety requirements."],
  ["Professional Service", "Professional and efficient service from enquiry through to project completion."],
  ["Complete Documentation", "Complete documentation and project support throughout the engagement."],
];

export default function ScaffoldingServicePage() {
  return (
    <>
      <PremiumHeader />
      <main className={`${kit.px} ${inner.page}`}>
        <BreadcrumbJsonLd items={[{ name: "Home", path: "/" }, { name: "Services", path: "/services" }, { name: "Scaffolding Rental & Installation", path: "/services/scaffolding" }]} />

        <InnerHero
          titleId="scaffolding-hero-title"
          crumbs={[{ label: "Home", href: "/" }, { label: "Services", href: "/services" }, { label: "Scaffolding Rental & Installation" }]}
          eyebrow="Scaffolding Rental & Installation"
          title="Safe, Reliable Scaffolding Solutions"
          lead="Rental, erection, dismantling, inspection and maintenance support for construction and industrial projects."
          actions={<div className={inner.actions}><a className={kit.btn} href="/request-proposal">Request a Quotation</a><a className={`${kit.btn} ${kit.btnLight}`} href={whatsappHref} target="_blank" rel="noreferrer">WhatsApp Us<span className="sr-only"> (opens in a new tab)</span></a></div>}
        />

        <section className={kit.sec} aria-labelledby="overview-title">
          <div className={`${kit.wrap} ${inner.twoCol}`}>
            <div className={inner.statement}>
              <span className={`${inner.eyebrow} ${inner.onLight}`}>Service Overview</span>
              <h2 id="overview-title">Scaffolding Support for Every Project Stage</h2>
            </div>
            <div className={inner.statement}>
              <p>TERAS UNIVERSAL provides scaffolding rental and installation services for construction, maintenance and industrial projects, covering short and long-term rental, erection, dismantling, and ongoing inspection and maintenance support.</p>
              <p>Our teams work in a structured and systematic manner from the initial site assessment through to dismantling, with safety and site organisation as an ongoing priority throughout the engagement.</p>
            </div>
          </div>
        </section>

        <section className={`${kit.sec} ${kit.trust}`} aria-labelledby="scaffolding-services-title">
          <div className={kit.wrap}>
            <SectionHead id="scaffolding-services-title" eyebrow="Our Scaffolding Services" title="A complete scaffolding service, start to finish." />
            <CardGrid label="Scaffolding services" items={services} />
          </div>
        </section>

        <section className={kit.sec} aria-labelledby="scaffolding-types-title">
          <div className={kit.wrap}>
            <SectionHead id="scaffolding-types-title" eyebrow="Types of Scaffolding" title="Scaffolding systems for different project needs." />
            <CardGrid label="Types of scaffolding" items={types.map((name) => ({ title: name }))} />
          </div>
        </section>

        <section className={`${kit.sec} ${kit.trust}`} aria-labelledby="scaffolding-why-title">
          <div className={kit.wrap}>
            <SectionHead id="scaffolding-why-title" eyebrow="Why Choose TERAS UNIVERSAL" title="Built on safety, quality and reliability." />
            <CardGrid label="Why choose TERAS UNIVERSAL" items={reasons.map(([title, text]) => ({ title, text }))} />
          </div>
        </section>

        <section className={kit.sec} aria-labelledby="scaffolding-contact-title">
          <div className={`${kit.wrap} ${inner.twoCol}`}>
            <div>
              <span className={`${inner.eyebrow} ${inner.onLight}`}>TERAS UNIVERSAL Scaffolding</span>
              <h2 id="scaffolding-contact-title">Scaffolding Solutions You Can Rely On</h2>
              <p>Safe, reliable and professionally managed scaffolding solutions for construction, maintenance and industrial projects. Reach out to discuss your rental duration, scaffolding type and site requirements.</p>
            </div>
            <dl className={`${inner.ledger} ${inner.ledgerWrap}`}>
              <div><dt>Quotation</dt><dd><a className={kit.tl} href="/request-proposal">Request a Quotation</a></dd></div>
              <div><dt>WhatsApp</dt><dd><a className={kit.tl} href={whatsappHref} target="_blank" rel="noreferrer">Enquire About Scaffolding<span className="sr-only"> (opens in a new tab)</span></a></dd></div>
              <div><dt>Call or WhatsApp</dt><dd><a className={kit.tl} href="tel:+60195193834">019-519 3834</a></dd></div>
              <div><dt>Email</dt><dd><a className={kit.tl} href="mailto:training@terasuniversal.com.my">training@terasuniversal.com.my</a></dd></div>
            </dl>
          </div>
        </section>

        <CtaBand id="scaffolding-cta-title" eyebrow="Scaffolding Enquiries" title="Need Scaffolding for Your Next Project?" text="Talk to TERAS UNIVERSAL about your project requirements, rental duration and site needs.">
          <a className={kit.btn} href="/request-proposal">Request a Quotation</a>
          <a className={`${kit.btn} ${kit.btnLight}`} href={whatsappHref} target="_blank" rel="noreferrer">WhatsApp 019-519 3834<span className="sr-only"> (opens in a new tab)</span></a>
        </CtaBand>
      </main>
      <Footer />
    </>
  );
}
