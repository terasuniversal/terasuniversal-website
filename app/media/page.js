import SiteHeader from "../../components/SiteHeader";
import SiteFooter from "../../components/SiteFooter";
import MediaCentre from "../../components/MediaCentre";
import NewsletterSignup from "../../components/NewsletterSignup";

export const metadata = {
  title: "Media Centre",
  description: "TERAS UNIVERSAL news, announcements, events and press releases.",
  alternates: { canonical: "/media" },
  openGraph: { title: "Media Centre | TERAS UNIVERSAL", description: "News, announcements, events and press releases from TERAS UNIVERSAL.", url: "/media" },
};

export default function MediaPage() {
  return (
    <main className="utility-page">
      <SiteHeader />
      <div className="container utility-container">
        <span className="eyebrow">Media Centre</span>
        <h1>News, announcements, events &amp; press releases.</h1>
        <p className="utility-lead">Company news and announcements will be published here as they are confirmed. For training articles and safety insights, visit our <a href="/insights">News &amp; Insights</a> hub.</p>
        <MediaCentre />
        <NewsletterSignup />
      </div>
      <SiteFooter />
    </main>
  );
}
