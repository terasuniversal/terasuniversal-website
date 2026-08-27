import { notFound } from "next/navigation";
import { insights } from "../../../data/insights";
import BreadcrumbJsonLd from "../../../components/public/BreadcrumbJsonLd";

export function generateStaticParams() { return insights.map(({ slug }) => ({ slug })); }
export async function generateMetadata({ params }) { const { slug } = await params; const item = insights.find((entry) => entry.slug === slug); return item ? { title: item.title, description: item.metaDescription || item.excerpt, alternates: { canonical: `/insights/${item.slug}` }, robots: { index: false, follow: true }, openGraph: { title: item.title, description: item.metaDescription || item.excerpt, type: "article" } } : {}; }

function renderBody(item) {
  if (!Array.isArray(item.body)) return <div className="insight-article-body"><p>Industrial work environments require clear expectations, practical understanding and consistent follow-through. This insight is awaiting editorial review before substantive guidance is published.</p></div>;
  return <div className="insight-article-body">{item.body.map((section) => <section key={section.heading}><h2>{section.heading}</h2>{section.paragraphs?.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}{section.bullets?.length ? <ul>{section.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul> : null}</section>)}</div>;
}

function RelatedLinks({ item }) {
  const links = [...(item.relatedCourses || []), ...(item.relatedIndustries || [])];
  if (!links.length) return null;
  const labels = { "/training": "Explore Training", "/training/working-at-height": "Working at Height Training", "/training/confined-space-safety": "Confined Space Safety", "/training/basic-scaffolder-level-1": "Basic Scaffolder Level 1", "/corporate-training": "Explore Corporate Training", "/industries": "Explore Industries", "/industries/construction": "Construction Industry Context", "/industries/oil-gas": "Oil & Gas Industry Context", "/calendar?course=working-at-height": "View Working at Height Dates", "/calendar": "View Training Calendar", "/request-proposal": "Discuss Requirements" };
  return <section className="insight-related-links" aria-labelledby="insight-related-title"><h2 id="insight-related-title">Continue exploring</h2><div>{links.map((path) => <a className="btn btn-outline" href={path} key={path}>{labels[path] || "View Related Page"}<span aria-hidden="true">&rarr;</span></a>)}</div></section>;
}

export default async function InsightPage({ params }) { const { slug } = await params; const item = insights.find((entry) => entry.slug === slug); if (!item) notFound(); const isTna = item.slug === "training-needs-analysis"; return <main className="insight-article-page"><BreadcrumbJsonLd items={[{ name: "Home", path: "/" }, { name: "Insights", path: "/insights" }, { name: item.title, path: `/insights/${item.slug}` }]} /><article className="container insight-article"><nav className="course-breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a><span>/</span><a href="/insights">Insights</a><span>/</span><span aria-current="page">{item.title}</span></nav><span className="eyebrow">{item.category} · {item.readTime}{item.audience ? ` · For ${item.audience}` : ""}</span><h1>{item.title}</h1><p className="insight-article-lead">{item.excerpt}</p>{renderBody(item)}<RelatedLinks item={item} /><div className="insight-article-cta"><h2>{item.ctaLabel || (isTna ? "Discuss your workforce development requirements" : "Explore a more structured competency approach")}</h2><a className="btn btn-gold" href={item.ctaHref || (isTna ? "/corporate-training" : "/training")}>{item.ctaLabel || (isTna ? "Discuss Corporate Training Requirements" : "Explore Training Options")} <span aria-hidden="true">&rarr;</span></a></div></article></main>; }
