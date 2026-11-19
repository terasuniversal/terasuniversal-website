import PremiumHeader from "../../components/premium/PremiumHeader";
import spacing from "../../components/premium/utility-spacing.module.css";
import PremiumFooter from "../../components/premium/PremiumFooter";
import InsightsCentre from "../../components/InsightsCentre";
import EbookPromo from "../../components/ebook/EbookPromo";
import LeadGenCta from "../../components/LeadGenCta";
import NewsletterSignup from "../../components/NewsletterSignup";
import { newsletterEnabled } from "../../lib/newsletter-gate";
import { socialMetadata } from "../../lib/social-metadata";
import { publicBody } from "../../components/premium/fonts";
import bridge from "../../components/premium/legacy-bridge.module.css";

export const metadata = { title: "News & Articles", description: "Practical articles on industrial safety, scaffolding, competency development and workforce training from TERAS UNIVERSAL.", alternates: { canonical: "/insights" }, ...socialMetadata({ title: "News & Articles | TERAS UNIVERSAL", description: "Practical articles on industrial safety, scaffolding, competency development and workforce training from TERAS UNIVERSAL.", path: "/insights" }) };

// Phase S4D-2C: the shared Premium header replaces the page's own legacy header and, as on the other Premium
// pages, sits before <main> rather than inside it. Everything inside <main> is unchanged.
export default function InsightsPage() { return <><PremiumHeader /><main className={`utility-page ${spacing.afterHeader} ${bridge.page} ${publicBody.variable}`}><div className="container utility-container"><span className="eyebrow">News &amp; Articles</span><h1>Practical insight for safer, stronger workforces.</h1><p className="utility-lead">Explore practical perspectives on industrial safety, competency development, construction work and compliance-focused training.</p><InsightsCentre /><EbookPromo />{newsletterEnabled() && <div className="insights-newsletter-block"><span className="eyebrow">Stay Informed</span><h2>Get new insights in your inbox</h2><NewsletterSignup /></div>}<LeadGenCta /></div></main><PremiumFooter /></>; }
