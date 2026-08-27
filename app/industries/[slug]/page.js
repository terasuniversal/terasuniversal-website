import Image from "next/image";
import MobileNav from "../../../components/MobileNav";
import MegaNav from "../../../components/MegaNav";
import Footer from "../../../components/Footer";
import CorporateTrainingCta from "../../../components/public/CorporateTrainingCta";
import DeliveryOptions from "../../../components/public/DeliveryOptions";
import IndustrySolutions from "../../../components/public/IndustrySolutions";
import { industries, findIndustry } from "../../../data/industries";
import { courseCatalog } from "../../../data/courseCatalog";

export function generateStaticParams() { return industries.map(({ slug }) => ({ slug })); }
export async function generateMetadata({ params }) { const { slug } = await params; const industry = findIndustry(slug); return industry ? { title: `${industry.name} Training Solutions`, description: industry.summary, alternates: { canonical: `/industries/${industry.slug}` }, openGraph: { title: `${industry.name} Training Solutions | TERAS UNIVERSAL`, description: industry.summary, url: `/industries/${industry.slug}` } } : { title: "Industry Solutions" }; }

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

      <section className="industry-hero"><div className="container"><nav className="course-breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a><span>/</span><a href="/industries">Industries</a><span>/</span><span aria-current="page">{industry.name}</span></nav><span className="eyebrow">Corporate Solutions &middot; {industry.fullName}</span><h1>{industry.name} Training &amp; Competency Solutions</h1><p>{industry.summary}</p><div className="hero-actions"><a className="btn btn-primary" href={`/request-proposal?industry=${encodeURIComponent(industry.slug)}&source=industry-page`}>Request {industry.name} Training</a><a className="btn btn-outline" href="/corporate-training">Explore Corporate Training</a></div></div></section>

      <section className="industry-focus-section"><div className="container industry-focus-grid"><div><span className="eyebrow">Sector Focus</span><h2>Built around {industry.name.toLowerCase()} operating realities.</h2><p>{industry.focus}</p></div></div></section>

      <section className="training-delivery-section"><div className="container"><div className="section-heading"><span className="eyebrow">Relevant TERAS Solutions</span><h2>Connect the requirement with the right capability route.</h2></div><IndustrySolutions /></div></section>

      <section className="industry-programmes-section"><div className="container"><div className="section-heading"><span className="eyebrow">Relevant Programmes</span><h2>Training aligned with this sector.</h2></div><div className="industry-programmes-grid">{relevantCourses.map((course) => <a className="industry-programme-card" href={`/training/${course.slug}`} key={course.slug}><span className="eyebrow">{course.category}</span><h3>{course.title}</h3><p>{course.summary}</p><span className="industries-hub-link">View Programme <span aria-hidden="true">&rarr;</span></span></a>)}</div></div></section>

      <section className="training-delivery-section"><div className="container"><div className="section-heading"><span className="eyebrow">Delivery Options</span><h2>Arrange learning around the work and the team.</h2></div><DeliveryOptions /></div></section>

      {industry.clients.length > 0 && <section className="industry-clients-section"><div className="container"><div className="section-heading"><span className="eyebrow">Among Organisations We&apos;ve Supported</span><h2>Trusted across {industry.name.toLowerCase()}.</h2></div><div className="industry-clients-grid">{industry.clients.map((client) => <span key={client}>{client}</span>)}</div></div></section>}

      <section className="container"><CorporateTrainingCta industry={industry.slug} source="industry-page-final" title={`Planning ${industry.name} training for your team?`} text="Share the workforce, operating context and preferred delivery arrangement so TERAS can begin the right conversation." /></section>

      <Footer />
    </main>
  );
}
