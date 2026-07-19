import SiteHeader from "../../../components/SiteHeader";
import SiteFooter from "../../../components/SiteFooter";
import TrainingComparison from "../../../components/TrainingComparison";

export default function TrainingComparePage() {
  return (
    <main className="utility-page compare-page">
      <SiteHeader />
      <div className="container utility-container">
        <nav className="course-breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a><span>/</span><a href="/training">Training</a><span>/</span><span aria-current="page">Compare Programmes</span></nav>
        <span className="eyebrow">Training Comparison</span>
        <h1>Compare training programmes side by side.</h1>
        <p className="utility-lead">Review target audience, delivery mode, assessment approach and completion requirements across programmes before requesting a proposal.</p>
        <TrainingComparison />
        <div className="compare-cta-section">
          <div className="premium-cta compare-cta">
            <div><span>Need a Custom Recommendation?</span><h2>Not sure which programme fits your team?</h2><p>Share your workforce profile and operational requirements and we will recommend a suitable training pathway.</p></div>
            <a className="btn btn-light" href="/request-proposal">Request a Proposal</a>
          </div>
        </div>
      </div>
      <SiteFooter />
    </main>
  );
}
