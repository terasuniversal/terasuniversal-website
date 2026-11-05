import Footer from "../../components/Footer";
import Recognition from "../../components/home/Recognition";
import TrainingComparison from "../../components/TrainingComparison";
import TrainingFinder from "../../components/TrainingFinder";
import CtaBand from "../../components/premium/CtaBand";
import InnerHero from "../../components/premium/InnerHero";
import PremiumHeader from "../../components/premium/PremiumHeader";
import ProgrammeBrowser from "../../components/premium/ProgrammeBrowser";
import SectionHead from "../../components/premium/SectionHead";
import kit from "../../components/premium/premium.module.css";
import inner from "../../components/premium/inner.module.css";
import { comparableCourses } from "../../data/courseCatalog";

// The JKKP recognition shown in the Recognition block expires; re-render hourly so it flips on the day it ends.
export const revalidate = 3600;

const deliveryOptions = [["01", "Public Programme", "Scheduled learning for individuals and employees from different organisations."], ["02", "In-House Training", "A focused programme delivered exclusively for one organisation or workforce group."], ["03", "Onsite Training", "Practical learning arranged at a client workplace, plant, project site or approved facility."], ["04", "Competency Assessment", "Structured theoretical and practical evaluation against defined requirements."]];

export default function TrainingPage() {
  return <>
    <PremiumHeader />
    <main className={`${kit.px} ${inner.page}`}>
      <InnerHero
        titleId="training-hero-title"
        crumbs={[{ label: "Home", href: "/" }, { label: "Training" }]}
        eyebrow="Training Programmes"
        title="Practical Training for Safer and More Competent Workforces"
        lead="Explore TERAS public course pages, then review available sessions or discuss an arrangement for your workforce."
        actions={<div className={inner.actions}><a className={kit.btn} href="#course-catalogue">View Training</a><a className={`${kit.btn} ${kit.btnLight}`} href="/request-proposal?source=training-hero">Request Corporate Training</a></div>}
        chips={["Practical Delivery", "Industry Focused", "Competency Based", "Custom Programmes"]}
      />

      <section id="course-catalogue" className={kit.sec} aria-labelledby="programme-title">
        <div className={kit.wrap}>
          <SectionHead id="programme-title" eyebrow="Course Catalogue" title="Find a verified public course page.">Each course below has its own public detail page. Other workforce requirements can be discussed directly with TERAS.</SectionHead>
          <ProgrammeBrowser />
        </div>
      </section>

      <section id="training-finder" className={`${kit.sec} ${kit.trust}`} aria-labelledby="training-finder-title">
        <div className={kit.wrap}>
          <SectionHead id="training-finder-title" eyebrow="Training Finder" title="Find a practical starting point for your workforce.">Answer four quick questions and review a suggested training pathway. Our team can refine it around your site and operating requirements.</SectionHead>
          <TrainingFinder />
        </div>
      </section>

      <section className={kit.sec} aria-labelledby="compare-title">
        <div className={kit.wrap}>
          <SectionHead id="compare-title" eyebrow="Compare Programmes" title="Not sure which level is right for your team?">Select up to 3 programmes to compare duration, delivery mode, assessment and completion side by side. All figures shown are verified against the official TERAS UNIVERSAL course catalogue.</SectionHead>
          <TrainingComparison courses={comparableCourses()} />
        </div>
      </section>

      <section className={`${kit.sec} ${kit.band}`} aria-labelledby="delivery-title">
        <div className={kit.wrap}>
          <SectionHead id="delivery-title" eyebrow="Delivery Options" onNavy title="A flexible arrangement for every organisation.">Public course details and calendar entries are published separately from custom, in-house and onsite arrangements.</SectionHead>
          <ul className={inner.modes4}>{deliveryOptions.map(([number, title, text]) => <li key={title}><span>{number}</span><h3>{title}</h3><p>{text}</p></li>)}</ul>
        </div>
      </section>

      <Recognition />

      <CtaBand id="training-cta-title" eyebrow="Corporate & Custom Solutions" title="Need a Programme Built Around Your Workforce?" text="Discuss a customised training solution aligned with your operational requirements, participant profile and delivery arrangement.">
        <a className={kit.btn} href="/request-proposal?source=training-corporate">Request Corporate Training</a>
        <a className={`${kit.btn} ${kit.btnLight}`} href="https://wa.me/60195193834?text=Hi%20TERAS%2C%20saya%20ingin%20bertanya%20tentang%20latihan%20korporat." target="_blank" rel="noreferrer">WhatsApp TERAS<span className="sr-only"> (opens in a new tab)</span></a>
      </CtaBand>
    </main>
    <Footer />
  </>;
}
