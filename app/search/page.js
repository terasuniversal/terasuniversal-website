import PremiumHeader from "../../components/premium/PremiumHeader";
import spacing from "../../components/premium/utility-spacing.module.css";
import PremiumFooter from "../../components/premium/PremiumFooter";
import SiteSearch from "../../components/SiteSearch";
import LeadGenCta from "../../components/LeadGenCta";
import { socialMetadata } from "../../lib/social-metadata";
import { publicBody } from "../../components/premium/fonts";
import bridge from "../../components/premium/legacy-bridge.module.css";

export const metadata = {
  title: "Search",
  description: "Search TERAS UNIVERSAL training programmes, services, resources and FAQs.",
  alternates: { canonical: "/search" },
  robots: { index: false, follow: true },
  ...socialMetadata({ title: "Search | TERAS UNIVERSAL", description: "Search TERAS UNIVERSAL training programmes, services, resources and FAQs.", path: "/search" }),
};

// Phase S4D-2B: the shared Premium header replaces the page's own legacy header and, as on the other Premium
// pages, sits before <main> rather than inside it. Everything inside <main> is unchanged.
export default function SearchPage() {
  return <><PremiumHeader /><main className={`utility-page ${spacing.afterHeader} ${bridge.page} ${publicBody.variable}`}><div className="container utility-container"><span className="eyebrow">Website Search</span><h1>Find the information you need.</h1><p className="utility-lead">Search across TERAS UNIVERSAL programmes, services, resources and frequently asked questions.</p><SiteSearch /><LeadGenCta title="Can't find what you're looking for?" text="Send us your requirements directly and our team will point you in the right direction." /></div></main><PremiumFooter /></>;
}
