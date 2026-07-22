import Image from "next/image";
import MobileNav from "../../components/MobileNav";
import MegaNav from "../../components/MegaNav";
import Footer from "../../components/Footer";
import SiteSearch from "../../components/SiteSearch";
import LeadGenCta from "../../components/LeadGenCta";

export const metadata = {
  title: "Search",
  description: "Search TERAS UNIVERSAL training programmes, services, resources and FAQs.",
  alternates: { canonical: "/search" },
};

export default function SearchPage() {
  return <main className="utility-page"><header className="site-header"><div className="container nav-wrap"><a className="brand" href="/" aria-label="TERAS UNIVERSAL home"><Image src="/teras-universal-logo.png" alt="TERAS UNIVERSAL logo" width={220} height={140} priority sizes="154px" /></a><MegaNav /><MobileNav basePath="/" /></div></header><div className="container utility-container"><span className="eyebrow">Website Search</span><h1>Find the information you need.</h1><p className="utility-lead">Search across TERAS UNIVERSAL programmes, services, resources and frequently asked questions.</p><SiteSearch /><LeadGenCta title="Can't find what you're looking for?" text="Send us your requirements directly and our team will point you in the right direction." /></div><Footer /></main>;
}
