import PremiumHeader from "../../../components/premium/PremiumHeader";
import Footer from "../../../components/Footer";
import InnerHero from "../../../components/premium/InnerHero";
import kit from "../../../components/premium/premium.module.css";
import inner from "../../../components/premium/inner.module.css";

// Kept at this URL for compatibility with the previous flow. The page only confirms that the request was sent from the
// form; it does not say anything about email, because whether a confirmation email goes out is not known here.
export const metadata = {
  title: { absolute: "Proposal Request Received | TERAS UNIVERSAL" },
  description: "Your TERAS UNIVERSAL proposal request has been received.",
  robots: { index: false, follow: false },
};

export default function ProposalSuccessPage() {
  return (
    <>
      <PremiumHeader />
      <main className={`${kit.px} ${inner.page}`}>
        <InnerHero
          titleId="proposal-success-title"
          crumbs={[{ label: "Home", href: "/" }, { label: "Request a Proposal", href: "/request-proposal" }, { label: "Request received" }]}
          eyebrow="Request received"
          title="Thank you for sharing your requirements"
          lead="Your proposal request has been submitted to TERAS UNIVERSAL. If you need to reach us directly, the contact details are on the Contact page."
          actions={<div className={inner.actions}><a className={kit.btn} href="/contact">Contact details</a><a className={`${kit.btn} ${kit.btnLight}`} href="/">Return home</a><a className={`${kit.btn} ${kit.btnLight}`} href="/training">Explore Training</a></div>}
        />
      </main>
      <Footer />
    </>
  );
}
