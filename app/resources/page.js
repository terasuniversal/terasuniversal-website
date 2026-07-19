import SiteHeader from "../../components/SiteHeader";
import SiteFooter from "../../components/SiteFooter";
import ResourceCentre from "../../components/ResourceCentre";

export const metadata = { title: "Resources", description: "TERAS UNIVERSAL corporate resources, course information and training materials.", alternates: { canonical: "/resources" } };

export default function ResourcesPage() {
  return (
    <main className="utility-page">
      <SiteHeader />
      <div className="container utility-container">
        <span className="eyebrow">Resources Centre</span>
        <h1>Useful information for better training decisions.</h1>
        <p className="utility-lead">Search or filter corporate information and training resources, or speak with our team when you need a tailored recommendation.</p>
        <ResourceCentre />
      </div>
      <SiteFooter />
    </main>
  );
}
