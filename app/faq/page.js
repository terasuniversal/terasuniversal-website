import SiteHeader from "../../components/SiteHeader";
import SiteFooter from "../../components/SiteFooter";
import ContextualCta from "../../components/ContextualCta";
import FaqCentre from "../../components/FaqCentre";
import { faqItems } from "../../data/faq";

export const metadata = { title: "FAQ Centre", description: "Frequently asked questions about TERAS UNIVERSAL industrial safety training, delivery and proposals.", alternates: { canonical: "/faq" } };
const faqSchema = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faqItems.map(([, question, answer]) => ({ "@type": "Question", name: question, acceptedAnswer: { "@type": "Answer", text: answer } })) };

export default function FaqPage() {
  return (
    <main className="utility-page">
      <SiteHeader />
      <div className="container utility-container">
        <span className="eyebrow">FAQ Centre</span>
        <h1>Clear answers before your next training decision.</h1>
        <p className="utility-lead">Search common questions about training delivery, programme design, participants, certification, government enquiries and payments.</p>
        <FaqCentre />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />
      </div>
      <ContextualCta variant="advisor" />
      <SiteFooter />
    </main>
  );
}
