import PremiumHeader from "../../components/premium/PremiumHeader";
import spacing from "../../components/premium/utility-spacing.module.css";
import PremiumFooter from "../../components/premium/PremiumFooter";
import FaqCentre from "../../components/FaqCentre";
import LeadGenCta from "../../components/LeadGenCta";
import { faqItems } from "../../data/faq";
import { socialMetadata } from "../../lib/social-metadata";
import { publicBody } from "../../components/premium/fonts";
import bridge from "../../components/premium/legacy-bridge.module.css";

export const metadata = { title: "FAQ Centre", description: "Frequently asked questions about TERAS UNIVERSAL industrial safety training, delivery and proposals.", alternates: { canonical: "/faq" }, ...socialMetadata({ title: "FAQ Centre | TERAS UNIVERSAL", description: "Frequently asked questions about TERAS UNIVERSAL industrial safety training, delivery and proposals.", path: "/faq" }) };
const faqSchema = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faqItems.map(([, question, answer]) => ({ "@type": "Question", name: question, acceptedAnswer: { "@type": "Answer", text: answer } })) };
// Phase S4D-2B: the shared Premium header replaces the page's own legacy header and, as on the other Premium
// pages, sits before <main> rather than inside it. Everything inside <main> is unchanged.
export default function FaqPage() { return <><PremiumHeader /><main className={`utility-page ${spacing.afterHeader} ${bridge.page} ${publicBody.variable}`}><div className="container utility-container"><span className="eyebrow">FAQ Centre</span><h1>Clear answers before your next training decision.</h1><p className="utility-lead">Search common questions about training delivery, programme design, participants, certification and corporate enquiries.</p><FaqCentre /><LeadGenCta title="Still have a question?" text="If you can't find what you're looking for, speak with our team directly or send a proposal request." /><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} /></div></main><PremiumFooter /></>; }
