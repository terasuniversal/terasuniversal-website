import { notFound } from "next/navigation";
import { insights } from "../../../data/insights";
import BreadcrumbJsonLd from "../../../components/public/BreadcrumbJsonLd";
import PremiumHeader from "../../../components/premium/PremiumHeader";
import PremiumFooter from "../../../components/premium/PremiumFooter";
import { socialMetadata } from "../../../lib/social-metadata";
import { publicBody } from "../../../components/premium/fonts";
import bridge from "../../../components/premium/legacy-bridge.module.css";
import { CANONICAL_ORIGIN } from "../../../lib/canonical-origin";

export function generateStaticParams() { return insights.map(({ slug }) => ({ slug })); }
// S5B-1B Round 2: every article is known at build time (data/insights.js), so unknown slugs are rejected by the router
// with a real HTTP 404. Without this, an unknown slug was rendered on demand inside the root app/loading.js Suspense
// boundary: streaming had already sent HTTP 200 when notFound() ran, leaving a "soft 404" (404 page, 200 status).
export const dynamicParams = false;
export async function generateMetadata({ params }) { const { slug } = await params; const item = insights.find((entry) => entry.slug === slug); return item ? { title: item.title, description: item.metaDescription || item.excerpt, alternates: { canonical: `/insights/${item.slug}` }, robots: { index: false, follow: true }, ...socialMetadata({ title: item.title, description: item.metaDescription || item.excerpt, path: `/insights/${item.slug}`, type: "article" }) } : {}; }

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

// S6: schema.org Article built only from data/insights.js and fixed organisation facts. No datePublished or author
// person is given because no verified publication date or named author exists yet (editorial gap, see S6 reports).
function ArticleJsonLd({ item }) {
  if (!Array.isArray(item.body)) return null;
  const url = `${CANONICAL_ORIGIN}/insights/${item.slug}`;
  const organisation = { "@type": "Organization", name: "TERAS UNIVERSAL SDN. BHD.", url: CANONICAL_ORIGIN };
  const schema = { "@context": "https://schema.org", "@type": "Article", headline: item.title, description: item.metaDescription || item.excerpt, articleSection: item.category, inLanguage: "en", isAccessibleForFree: true, mainEntityOfPage: url, url, author: organisation, publisher: organisation };
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />;
}

// S6: further reading from the same collection (same topic first), only articles with a full body.
function MoreArticles({ item }) {
  const others = insights.filter((entry) => entry.slug !== item.slug && Array.isArray(entry.body));
  const picks = [...others.filter((entry) => entry.category === item.category), ...others.filter((entry) => entry.category !== item.category)].slice(0, 3);
  if (!picks.length) return null;
  return <section className="insight-more" aria-labelledby="insight-more-title"><h2 id="insight-more-title">More articles</h2><ul>{picks.map((entry) => <li key={entry.slug}><span className="eyebrow">{entry.category}</span><a href={`/insights/${entry.slug}`}>{entry.title}</a><p>{entry.excerpt}</p></li>)}</ul><a className="insight-more-all" href="/insights">All news &amp; articles <span aria-hidden="true">&rarr;</span></a></section>;
}

export default async function InsightPage({ params }) { const { slug } = await params; const item = insights.find((entry) => entry.slug === slug); if (!item) notFound(); const isTna = item.slug === "training-needs-analysis"; return <><PremiumHeader /><main className={`insight-article-page ${bridge.page} ${publicBody.variable}`}><BreadcrumbJsonLd items={[{ name: "Home", path: "/" }, { name: "News & Articles", path: "/insights" }, { name: item.title, path: `/insights/${item.slug}` }]} /><ArticleJsonLd item={item} /><article className="container insight-article"><nav className="course-breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a><span>/</span><a href="/insights">News &amp; Articles</a><span>/</span><span aria-current="page">{item.title}</span></nav><span className="eyebrow">{item.category} · {item.readTime}{item.audience ? ` · For ${item.audience}` : ""}</span><h1>{item.title}</h1><p className="insight-article-lead">{item.excerpt}</p>{renderBody(item)}<RelatedLinks item={item} /><MoreArticles item={item} /><div className="insight-article-cta"><h2>{item.ctaLabel || (isTna ? "Discuss your workforce development requirements" : "Explore a more structured competency approach")}</h2><a className="btn btn-gold" href={item.ctaHref || (isTna ? "/corporate-training" : "/training")}>{item.ctaLabel || (isTna ? "Discuss Corporate Training Requirements" : "Explore Training Options")} <span aria-hidden="true">&rarr;</span></a></div></article></main><PremiumFooter /></>; }
