import SiteHeader from "../../components/SiteHeader";
import SiteFooter from "../../components/SiteFooter";
import SiteSearch from "../../components/SiteSearch";

export const metadata = {
  title: "Search",
  description: "Search TERAS UNIVERSAL training programmes, services, resources and FAQs.",
  alternates: { canonical: "/search" },
};

export default function SearchPage() {
  return (
    <main className="utility-page">
      <SiteHeader />
      <div className="container utility-container">
        <span className="eyebrow">Website Search</span>
        <h1>Find the information you need.</h1>
        <p className="utility-lead">Search across TERAS UNIVERSAL programmes, industries, resources and frequently asked questions.</p>
        <SiteSearch />
      </div>
      <SiteFooter />
    </main>
  );
}
