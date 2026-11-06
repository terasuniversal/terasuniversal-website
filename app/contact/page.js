import ContactEnquiryForm from "../../components/ContactEnquiryForm";
import Footer from "../../components/Footer";
import FactLedger from "../../components/premium/FactLedger";
import InnerHero from "../../components/premium/InnerHero";
import PremiumHeader from "../../components/premium/PremiumHeader";
import kit from "../../components/premium/premium.module.css";
import inner from "../../components/premium/inner.module.css";
import { companyProfile } from "../../data/companyProfile";

const { email, phone, address } = companyProfile.contact;
// The map is a link the visitor chooses to open. Nothing from Google loads until they do.
const mapHref = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
const phoneHref = `tel:${phone.replace(/[^\d+]/g, "")}`;
// WhatsApp is the existing site-wide channel (header and footer); it uses the same number as the phone above.
const whatsappHref = `https://wa.me/${phone.replace(/\D/g, "")}`;

export default function ContactPage() {
  const channels = [
    ["Email", <a key="email" className={inner.channelLink} href={`mailto:${email}`}>{email}</a>],
    ["Phone", <a key="phone" className={inner.channelLink} href={phoneHref}>{phone}</a>],
    ["WhatsApp", <a key="wa" className={inner.channelLink} href={whatsappHref} target="_blank" rel="noopener noreferrer">Message us on WhatsApp</a>],
    ["Address", <span key="addr">{address}</span>],
  ];
  return (
    <>
      <PremiumHeader />
      <main className={`${kit.px} ${inner.page}`}>
        <InnerHero
          titleId="contact-hero-title"
          crumbs={[{ label: "Home", href: "/" }, { label: "Contact" }]}
          eyebrow="Contact"
          title="Contact TERAS UNIVERSAL"
          lead="Send an enquiry about training or consultancy, or reach us directly. For an organisation-wide requirement, use the proposal request form."
          actions={<div className={inner.actions}><a className={kit.btn} href="#contact-form">Send an enquiry</a><a className={`${kit.btn} ${kit.btnLight}`} href="/request-proposal">Request a Proposal</a></div>}
        />

        <section className={kit.sec} id="contact-form" aria-labelledby="contact-form-title">
          <div className={`${kit.wrap} ${inner.formLayout}`}>
            <div>
              <h2 id="contact-form-title" className={inner.formHeading}>Send an enquiry</h2>
              <ContactEnquiryForm />
            </div>
            <aside className={inner.aside} aria-labelledby="channels-title">
              <h3 id="channels-title">Reach us directly</h3>
              <FactLedger facts={channels} />
              <p className={inner.mapNote}>
                <a className={inner.channelLink} href={mapHref} target="_blank" rel="noopener noreferrer">View this address on Google Maps<span className={inner.fieldMark}> (opens in a new tab)</span></a>
              </p>
            </aside>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
