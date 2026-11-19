import PremiumHeader from "../../components/premium/PremiumHeader";
import PremiumFooter from "../../components/premium/PremiumFooter";
import CorporateTrainingCta from "../../components/public/CorporateTrainingCta";
import { industries } from "../../data/industries";
import { socialMetadata } from "../../lib/social-metadata";
import { publicBody } from "../../components/premium/fonts";
import bridge from "../../components/premium/legacy-bridge.module.css";

export const metadata = { title: "Industries We Serve", description: "Industrial safety training and competency solutions for Oil & Gas, Construction, Petrochemical, Manufacturing, Marine, Heavy Industry and Government sectors.", alternates: { canonical: "/industries" }, ...socialMetadata({ title: "Industries We Serve | TERAS UNIVERSAL", description: "Industrial safety training and competency solutions for Oil & Gas, Construction, Petrochemical, Manufacturing, Marine, Heavy Industry and Government sectors.", path: "/industries" }) };

// Phase S4D-2B: the shared Premium header replaces the page's own legacy header and, as on the other Premium
// pages, sits before <main> rather than inside it. Everything inside <main> is unchanged.
export default function IndustriesPage() {
  return (
    <>
    <PremiumHeader />
    <main className={`industries-hub-page ${bridge.page} ${publicBody.variable}`}>

      <section className="industries-hub-hero"><div className="container"><span className="eyebrow">Corporate Solutions</span><h1>Industry-Focused Safety &amp; Competency Solutions</h1><p>TERAS UNIVERSAL supports safety-critical sectors with competency-based training, consultancy and workforce development shaped around real operational risk.</p><div className="hero-actions"><a className="btn btn-primary" href="/corporate-training">Explore Corporate Training</a><a className="btn btn-outline" href="/request-proposal?source=industries-hub">Request Proposal</a></div></div></section>

      <section className="industries-hub-grid-section"><div className="container"><div className="section-heading"><span className="eyebrow">Choose Your Sector</span><h2>From industry context to the right training conversation.</h2><p>Each sector page connects its operational context with relevant TERAS courses and a corporate enquiry path.</p></div><div className="industries-hub-grid">{industries.map((industry, index) => <a className="industries-hub-card" href={`/industries/${industry.slug}`} key={industry.slug}><span>{String(index + 1).padStart(2, "0")}</span><h2>{industry.name}</h2><p>{industry.summary}</p><span className="industries-hub-link">View Solutions <span aria-hidden="true">&rarr;</span></span></a>)}</div></div></section>

      <section className="container"><CorporateTrainingCta source="industries-hub-final" title="Not sure which sector best fits your requirements?" text="Tell TERAS about the work, workforce and delivery context so the right training or competency arrangement can be discussed." /></section>
    </main>

      <PremiumFooter />
    </>
  );
}
