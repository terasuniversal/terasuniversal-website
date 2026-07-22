import Image from "next/image";
import MobileNav from "../../../components/MobileNav";
import MegaNav from "../../../components/MegaNav";
import { industries, findIndustry } from "../../../data/industries";
import { courseCatalog } from "../../../data/courseCatalog";

export function generateStaticParams() { return industries.map(({ slug }) => ({ slug })); }
export async function generateMetadata({ params }) { const { slug } = await params; const industry = findIndustry(slug); return industry ? { title: `${industry.name} Training Solutions | TERAS UNIVERSAL`, description: industry.summary, alternates: { canonical: `/industries/${industry.slug}` }, openGraph: { title: `${industry.name} Training Solutions | TERAS UNIVERSAL`, description: industry.summary, url: `/industries/${industry.slug}` } } : { title: "Industry Solutions | TERAS UNIVERSAL" }; }

export default async function IndustryPage({ params }) {
  const { slug } = await params;
  const industry = findIndustry(slug);
  if (!industry) return <main className="utility-page"><div className="container utility-container"><h1>Industry page not found</h1><p>Return to our industries overview to explore the sectors we support.</p><a className="btn btn-primary" href="/industries">View Industries</a></div></main>;

  const relevantCourses = industry.relevantCourseSlugs.map((s) => courseCatalog.find((c) => c.slug === s)).filter(Boolean);

  return (
    <main className="industry-page">
      <header className="site-header">
        <div className="container nav-wrap">
          <a className="brand" href="/" aria-label="TERAS UNIVERSAL home"><Image src="/teras-universal-logo.png" alt="TERAS UNIVERSAL logo" width={220} height={140} priority sizes="154px" /></a>
          <MegaNav />
          <MobileNav basePath="/" />
        </div>
      </header>

      <section className="industry-hero"><div className="container"><nav className="course-breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a><span>/</span><a href="/industries">Industries</a><span>/</span><span aria-current="page">{industry.name}</span></nav><span className="eyebrow">Corporate Solutions &middot; {industry.fullName}</span><h1>{industry.name} Training &amp; Competency Solutions</h1><p>{industry.summary}</p><div className="hero-actions"><a className="btn btn-primary" href="/request-proposal">Request Proposal</a><a className="btn btn-outline" href="https://wa.me/60195193834" target="_blank" rel="noreferrer">WhatsApp Our Team</a></div></div></section>

      <section className="industry-focus-section"><div className="container industry-focus-grid"><div><span className="eyebrow">Sector Focus</span><h2>Built around {industry.name.toLowerCase()} operating realities.</h2><p>{industry.focus}</p></div></div></section>

      <section className="industry-programmes-section"><div className="container"><div className="section-heading"><span className="eyebrow">Relevant Programmes</span><h2>Training aligned with this sector.</h2></div><div className="industry-programmes-grid">{relevantCourses.map((course) => <a className="industry-programme-card" href={`/training/${course.slug}`} key={course.slug}><span className="eyebrow">{course.category}</span><h3>{course.title}</h3><p>{course.summary}</p><span className="industries-hub-link">View Programme <span aria-hidden="true">&rarr;</span></span></a>)}</div></div></section>

      {industry.clients.length > 0 && <section className="industry-clients-section"><div className="container"><div className="section-heading"><span className="eyebrow">Among Organisations We&apos;ve Supported</span><h2>Trusted across {industry.name.toLowerCase()}.</h2></div><div className="industry-clients-grid">{industry.clients.map((client) => <span key={client}>{client}</span>)}</div></div></section>}

      <section className="services-cta"><div className="container"><div><span className="eyebrow">Corporate &amp; Custom Solutions</span><h2>Planning {industry.name} Training For Your Team?</h2></div><div className="hero-actions"><a className="btn btn-light" href="/request-proposal">Request Proposal</a><a className="btn btn-gold" href="https://wa.me/60195193834" target="_blank" rel="noreferrer">WhatsApp Us</a></div></div></section>

      <footer><div className="container footer-grid"><div className="footer-brand"><Image src="/teras-universal-logo.png" alt="TERAS UNIVERSAL" width={210} height={135} sizes="190px" /><p>Building Competence. Creating Opportunities.</p></div><div><h3>Core Services</h3><p>Industrial Safety<br />Technical Competency<br />Industrial Consultancy<br />Workforce Development</p></div><div><h3>Contact</h3><p><a href="mailto:training@terasuniversal.com.my">training@terasuniversal.com.my</a><br /><a href="tel:+60195193834">+60 19-519 3834</a></p><p>Lot 1961, Jalan Tanah Merah,<br />Kg Tanah Merah Dalam,<br />06000 Jitra, Kedah, Malaysia</p></div></div><div className="container footer-bottom"><span>&copy; 2026 TERAS UNIVERSAL SDN. BHD. All rights reserved.</span><span>terasuniversal.com.my</span></div></footer>
    </main>
  );
}
