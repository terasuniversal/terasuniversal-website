import InsightsCentre from "../../components/InsightsCentre";
import LeadGenCta from "../../components/LeadGenCta";
import NewsletterSignup from "../../components/NewsletterSignup";

export const metadata = { title: "News & Insights", description: "Safety, construction, Oil & Gas, training and compliance insights from TERAS UNIVERSAL.", alternates: { canonical: "/insights" } };

export default function InsightsPage() { return <main className="utility-page"><div className="container utility-container"><span className="eyebrow">Knowledge Centre</span><h1>Practical insight for safer, stronger workforces.</h1><p className="utility-lead">Explore practical perspectives on industrial safety, competency development, construction work and compliance-focused training.</p><InsightsCentre /><div className="insights-newsletter-block"><span className="eyebrow">Stay Informed</span><h2>Get new insights in your inbox</h2><NewsletterSignup /></div><LeadGenCta /></div></main>; }
