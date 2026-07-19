import SiteHeader from "../../components/SiteHeader";
import SiteFooter from "../../components/SiteFooter";
import { approvedSuccessStories, approvedTestimonials } from "../../data/successStories";

export const metadata = { title: "Testimonials & Success Stories", description: "Approved customer testimonials, project summaries and workforce outcomes from TERAS UNIVERSAL.", alternates: { canonical: "/stories" } };

function EmptyState({ label, text }) { return <div className="stories-empty"><span className="eyebrow">{label}</span><h2>Customer stories will appear here.</h2><p>{text}</p><a className="btn btn-outline" href="/request-proposal">Discuss a programme</a></div>; }

export default function StoriesPage() {
  return (
    <main className="utility-page">
      <SiteHeader />
      <div className="container utility-container">
        <span className="eyebrow">Proof of Practice</span>
        <h1>Experience should be measured, not overstated.</h1>
        <p className="utility-lead">This space is reserved for approved testimonials, project summaries and outcomes that help organisations make informed training decisions.</p>
        <section className="stories-section" aria-labelledby="testimonials-title">
          <div className="section-heading"><span className="eyebrow">Testimonials</span><h2 id="testimonials-title">What our supported organisations say.</h2></div>
          {approvedTestimonials.length ? <div className="stories-grid">{approvedTestimonials.map((item) => <article key={item.quote}><blockquote>&ldquo;{item.quote}&rdquo;</blockquote><p>{item.name} &middot; {item.role}{item.organisation ? ` · ${item.organisation}` : ""}</p></article>)}</div> : <EmptyState label="Testimonials" text="Testimonials will be published only after the relevant organisation has approved the wording, attribution and use of its identity." />}
        </section>
        <section className="stories-section" aria-labelledby="success-title">
          <div className="section-heading"><span className="eyebrow">Success Stories</span><h2 id="success-title">From challenge to measurable improvement.</h2></div>
          {approvedSuccessStories.length ? <div className="stories-grid">{approvedSuccessStories.map((item) => <article key={item.title}><span className="eyebrow">{item.industry}</span><h3>{item.title}</h3><p>{item.summary}</p><a href={`/stories/${item.slug}`}>View case study <span aria-hidden="true">&rarr;</span></a></article>)}</div> : <EmptyState label="Case Studies" text="Project summaries will be added when the client, scope and outcomes are approved for public use." />}
        </section>
      </div>
      <SiteFooter />
    </main>
  );
}
