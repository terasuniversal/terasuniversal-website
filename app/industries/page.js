import Image from "next/image";
import MobileNav from "../../components/MobileNav";
import MegaNav from "../../components/MegaNav";
import { industries } from "../../data/industries";

export const metadata = { title: "Industries We Serve | TERAS UNIVERSAL", description: "Industrial safety training and competency solutions for Oil & Gas, Construction, Petrochemical, Manufacturing, Marine, Heavy Industry and Government sectors.", alternates: { canonical: "/industries" } };

export default function IndustriesPage() {
  return (
    <main className="industries-hub-page">
      <header className="site-header">
        <div className="container nav-wrap">
          <a className="brand" href="/" aria-label="TERAS UNIVERSAL home"><Image src="/teras-universal-logo.png" alt="TERAS UNIVERSAL logo" width={220} height={140} priority sizes="154px" /></a>
          <MegaNav />
          <MobileNav basePath="/" />
        </div>
      </header>

      <section className="industries-hub-hero"><div className="container"><span className="eyebrow">Corporate Solutions</span><h1>Industry-Focused Safety &amp; Competency Solutions</h1><p>TERAS UNIVERSAL supports safety-critical sectors with competency-based training, consultancy and workforce development shaped around real operational risk.</p><div className="hero-actions"><a className="btn btn-primary" href="/request-proposal">Request Proposal</a><a className="btn btn-outline" href="https://wa.me/60195193834" target="_blank" rel="noreferrer">WhatsApp Our Team</a></div></div></section>

      <section className="industries-hub-grid-section"><div className="container"><div className="industries-hub-grid">{industries.map((industry, index) => <a className="industries-hub-card" href={`/industries/${industry.slug}`} key={industry.slug}><span>{String(index + 1).padStart(2, "0")}</span><h2>{industry.name}</h2><p>{industry.summary}</p><span className="industries-hub-link">View Solutions <span aria-hidden="true">&rarr;</span></span></a>)}</div></div></section>

      <section className="services-cta"><div className="container"><div><span className="eyebrow">Corporate &amp; Custom Solutions</span><h2>Not Sure Which Sector Fits Your Requirements?</h2></div><div className="hero-actions"><a className="btn btn-light" href="/request-proposal">Request Proposal</a><a className="btn btn-gold" href="https://wa.me/60195193834" target="_blank" rel="noreferrer">WhatsApp Us</a></div></div></section>

      <footer><div className="container footer-grid"><div className="footer-brand"><Image src="/teras-universal-logo.png" alt="TERAS UNIVERSAL" width={210} height={135} sizes="190px" /><p>Building Competence. Creating Opportunities.</p></div><div><h3>Core Services</h3><p>Industrial Safety<br />Technical Competency<br />Industrial Consultancy<br />Workforce Development</p></div><div><h3>Contact</h3><p><a href="mailto:training@terasuniversal.com.my">training@terasuniversal.com.my</a><br /><a href="tel:+60195193834">+60 19-519 3834</a></p><p>Lot 1961, Jalan Tanah Merah,<br />Kg Tanah Merah Dalam,<br />06000 Jitra, Kedah, Malaysia</p></div></div><div className="container footer-bottom"><span>&copy; 2026 TERAS UNIVERSAL SDN. BHD. All rights reserved.</span><span>terasuniversal.com.my</span></div></footer>
    </main>
  );
}
