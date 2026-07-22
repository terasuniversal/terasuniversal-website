import Image from "next/image";
import MobileNav from "../../components/MobileNav";
import MegaNav from "../../components/MegaNav";
import Footer from "../../components/Footer";
import InsightsCentre from "../../components/InsightsCentre";
import LeadGenCta from "../../components/LeadGenCta";
import NewsletterSignup from "../../components/NewsletterSignup";

export const metadata = { title: "News & Insights", description: "Safety, construction, Oil & Gas, training and compliance insights from TERAS UNIVERSAL.", alternates: { canonical: "/insights" } };

export default function InsightsPage() { return <main className="utility-page"><header className="site-header"><div className="container nav-wrap"><a className="brand" href="/" aria-label="TERAS UNIVERSAL home"><Image src="/teras-universal-logo.png" alt="TERAS UNIVERSAL logo" width={220} height={140} priority sizes="154px" /></a><MegaNav /><MobileNav basePath="/" /></div></header><div className="container utility-container"><span className="eyebrow">Knowledge Centre</span><h1>Practical insight for safer, stronger workforces.</h1><p className="utility-lead">Explore practical perspectives on industrial safety, competency development, construction work and compliance-focused training.</p><InsightsCentre /><div className="insights-newsletter-block"><span className="eyebrow">Stay Informed</span><h2>Get new insights in your inbox</h2><NewsletterSignup /></div><LeadGenCta /></div><Footer /></main>; }
