import FaqCentre from "../../components/FaqCentre";
import LeadGenCta from "../../components/LeadGenCta";
import { faqItems } from "../../data/faq";

export const metadata = { title: "FAQ Centre", description: "Frequently asked questions about TERAS UNIVERSAL industrial safety training, delivery and proposals.", alternates: { canonical: "/faq" } };
const faqSchema = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faqItems.map(([, question, answer]) => ({ "@type": "Question", name: question, acceptedAnswer: { "@type": "Answer", text: answer } })) };
export default function FaqPage() { return <main className="utility-page"><div className="container utility-container"><span className="eyebrow">FAQ Centre</span><h1>Clear answers before your next training decision.</h1><p className="utility-lead">Search common questions about training delivery, programme design, participants, certification and corporate enquiries.</p><FaqCentre /><LeadGenCta title="Still have a question?" text="If you can't find what you're looking for, speak with our team directly or send a proposal request." /><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} /></div></main>; }
