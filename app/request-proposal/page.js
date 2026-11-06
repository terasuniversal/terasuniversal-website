import ProposalRequestForm from "../../components/ProposalRequestForm";
import Footer from "../../components/Footer";
import CtaBand from "../../components/premium/CtaBand";
import InnerHero from "../../components/premium/InnerHero";
import PremiumHeader from "../../components/premium/PremiumHeader";
import kit from "../../components/premium/premium.module.css";
import inner from "../../components/premium/inner.module.css";
import { companyProfile } from "../../data/companyProfile";

const { email, phone } = companyProfile.contact;
const phoneHref = `tel:${phone.replace(/[^\d+]/g, "")}`;
const whatsappHref = `https://wa.me/${phone.replace(/\D/g, "")}`;

export default function RequestProposalPage() {
  return (
    <>
      <PremiumHeader />
      <main className={`${kit.px} ${inner.page}`}>
        <InnerHero
          titleId="proposal-hero-title"
          crumbs={[{ label: "Home", href: "/" }, { label: "Request a Proposal" }]}
          eyebrow="Request a Proposal"
          title="Tell us about your training requirements"
          lead="Share your organisation's training requirements below. You can also contact TERAS UNIVERSAL directly using the details further down this page."
          actions={<div className={inner.actions}><a className={kit.btn} href="#proposal-form">Start your request</a><a className={`${kit.btn} ${kit.btnLight}`} href="/training">Explore Training</a></div>}
        />

        <section className={kit.sec} aria-labelledby="proposal-form-title">
          <div className={`${kit.wrap} ${inner.formLayout} ${inner.formSolo}`}>
            <div>
              <h2 id="proposal-form-title" className={inner.formHeading}>Your request</h2>
              <p className={inner.formNote}>Fields marked (required) must be completed. Everything else is optional.</p>
              <ProposalRequestForm />
            </div>
          </div>
        </section>

        <CtaBand id="proposal-contact-title" eyebrow="Prefer to talk first?" title="Reach us directly" text="You can also contact TERAS UNIVERSAL without using the form.">
          <a className={kit.btn} href={`mailto:${email}`}>Email</a>
          <a className={`${kit.btn} ${kit.btnLight}`} href={phoneHref}>Call</a>
          <a className={`${kit.btn} ${kit.btnLight}`} href={whatsappHref} target="_blank" rel="noopener noreferrer">WhatsApp</a>
        </CtaBand>
      </main>
      <Footer />
    </>
  );
}
