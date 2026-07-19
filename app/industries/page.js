import Image from "next/image";
import SiteHeader from "../../components/SiteHeader";
import SiteFooter from "../../components/SiteFooter";
import { industries } from "../../data/industries";

export const metadata = {
  title: "Industries We Serve",
  description: "Industrial safety training and consultancy for Oil & Gas, Construction, Manufacturing, Power & Energy, Marine & Offshore, Government and GLC organisations.",
  alternates: { canonical: "/industries" },
  openGraph: { title: "Industries We Serve | TERAS UNIVERSAL", description: "Industrial safety training and consultancy solutions by industry.", url: "/industries" },
};

export default function IndustriesPage() {
  return (
    <main className="utility-page industries-hub">
      <SiteHeader />
      <div className="container utility-container">
        <span className="eyebrow">Corporate Solutions</span>
        <h1>Industry solutions built around real operational challenges.</h1>
        <p className="utility-lead">Explore how TERAS UNIVERSAL supports safety-critical sectors with practical training and consultancy recommendations tailored to each industry.</p>
      </div>
      <div className="container">
        <div className="industries-hub-grid">
          {industries.map((industry) => (
            <article className="industries-hub-card" key={industry.slug}>
              <div className="industries-hub-media"><Image src={industry.image} alt={`${industry.name} industrial training visual.`} width={900} height={600} sizes="(max-width: 590px) 100vw, (max-width: 920px) 50vw, 33vw" /></div>
              <div className="industries-hub-content">
                <h2>{industry.name}</h2>
                <p>{industry.summary}</p>
                <a href={`/industries/${industry.slug}`}>Explore solutions <span aria-hidden="true">&rarr;</span></a>
              </div>
            </article>
          ))}
        </div>
      </div>
      <section className="premium-cta-section"><div className="container premium-cta"><div><span>Not Sure Where to Start?</span><h2>Tell us about your operating environment.</h2><p>Share your industry, workforce profile and operational requirements and we will recommend a suitable training and consultancy pathway.</p></div><a className="btn btn-light" href="/request-proposal">Request a Proposal</a></div></section>
      <SiteFooter />
    </main>
  );
}
