import Image from "next/image";
import { notFound } from "next/navigation";
import SiteHeader from "../../../components/SiteHeader";
import SiteFooter from "../../../components/SiteFooter";
import { industries, findIndustry } from "../../../data/industries";
import { courseCatalog, courseHref } from "../../../data/courseCatalog";

export function generateStaticParams() {
  return industries.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const industry = findIndustry(slug);
  if (!industry) return { title: "Industry Solutions | TERAS UNIVERSAL" };
  return {
    title: `${industry.name} Training & Consultancy`,
    description: industry.summary,
    alternates: { canonical: `/industries/${industry.slug}` },
    openGraph: { title: `${industry.name} Training & Consultancy | TERAS UNIVERSAL`, description: industry.summary, url: `/industries/${industry.slug}` },
  };
}

export default async function IndustryPage({ params }) {
  const { slug } = await params;
  const industry = findIndustry(slug);
  if (!industry) notFound();

  const recommendedCourses = industry.recommendedTraining.map((courseSlug) => courseCatalog.find((course) => course.slug === courseSlug)).filter(Boolean);

  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: industry.faq.map(([question, answer]) => ({ "@type": "Question", name: question, acceptedAnswer: { "@type": "Answer", text: answer } })),
  };

  return (
    <main className="utility-page industry-page">
      <SiteHeader />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />

      <section className="industry-hero" aria-labelledby="industry-hero-title">
        <div className="container industry-hero-grid">
          <div>
            <nav className="course-breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a><span>/</span><a href="/industries">Industries</a><span>/</span><span aria-current="page">{industry.shortName}</span></nav>
            <span className="eyebrow">Corporate Solutions &middot; {industry.shortName}</span>
            <h1 id="industry-hero-title">{industry.name} Training &amp; Consultancy</h1>
            <p>{industry.summary}</p>
            <div className="hero-actions"><a className="btn btn-primary" href="/request-proposal">Request a Proposal</a><a className="btn btn-outline" href="https://wa.me/60195193834" target="_blank" rel="noreferrer">WhatsApp Our Team</a></div>
          </div>
          <figure><Image src={industry.image} alt={`${industry.name} industrial training visual.`} width={1200} height={800} priority sizes="(max-width: 920px) 100vw, 52vw" /></figure>
        </div>
      </section>

      <section className="industry-overview-section" aria-labelledby="overview-title">
        <div className="container"><div className="section-heading"><span className="eyebrow">Industry Overview</span><h2 id="overview-title">Understanding the operating environment.</h2></div><p className="industry-overview-text">{industry.overview}</p></div>
      </section>

      <section className="industry-challenges-section soft-section" aria-labelledby="challenges-title">
        <div className="container"><div className="section-heading"><span className="eyebrow">Typical Challenges</span><h2 id="challenges-title">Common challenges organisations face.</h2></div>
          <div className="industry-challenges-grid">{industry.challenges.map((challenge, index) => <article key={challenge}><span>{String(index + 1).padStart(2, "0")}</span><p>{challenge}</p></article>)}</div>
        </div>
      </section>

      <section className="industry-services-section" aria-labelledby="services-title">
        <div className="container"><div className="section-heading"><span className="eyebrow">Recommended TERAS Services</span><h2 id="services-title">Where we can help.</h2></div>
          <div className="industry-services-grid">{industry.recommendedServices.map((service) => <span key={service}>{service}</span>)}</div>
          <a className="industry-services-link" href="/services">View all services <span aria-hidden="true">&rarr;</span></a>
        </div>
      </section>

      <section className="industry-training-section soft-section" aria-labelledby="training-title">
        <div className="container"><div className="section-heading"><span className="eyebrow">Recommended Training</span><h2 id="training-title">Relevant programmes for this industry.</h2></div>
          <div className="industry-training-grid">
            {recommendedCourses.map((course) => (
              <article key={course.slug}>
                <span className="eyebrow">{course.category}</span>
                <h3>{course.title}</h3>
                <p>{course.summary}</p>
                <a href={courseHref(course)}>View programme <span aria-hidden="true">&rarr;</span></a>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="industry-benefits-section" aria-labelledby="benefits-title">
        <div className="container"><div className="section-heading"><span className="eyebrow">Business Benefits</span><h2 id="benefits-title">What this means for your organisation.</h2></div>
          <ul className="industry-benefits-list">{industry.benefits.map((benefit) => <li key={benefit}><span aria-hidden="true">&#10003;</span>{benefit}</li>)}</ul>
        </div>
      </section>

      <section className="industry-faq-section soft-section" aria-labelledby="industry-faq-title">
        <div className="container"><div className="section-heading"><span className="eyebrow">Frequently Asked Questions</span><h2 id="industry-faq-title">Questions from {industry.shortName} organisations.</h2></div>
          <div className="industry-faq-list">{industry.faq.map(([question, answer]) => <details key={question}><summary>{question}<span aria-hidden="true">+</span></summary><p>{answer}</p></details>)}</div>
        </div>
      </section>

      <section className="premium-cta-section"><div className="container premium-cta"><div><span>Corporate &amp; Custom Solutions</span><h2>Ready to strengthen safety and competency in {industry.shortName.toLowerCase()}?</h2><p>Speak with our team about a training and consultancy solution shaped around your operations.</p></div><a className="btn btn-light" href="/request-proposal">Request a Proposal</a></div></section>

      <nav className="industry-related-nav" aria-label="Other industries"><div className="container"><span>Other industries:</span>{industries.filter((item) => item.slug !== industry.slug).map((item) => <a key={item.slug} href={`/industries/${item.slug}`}>{item.shortName}</a>)}</div></nav>

      <SiteFooter />
    </main>
  );
}
