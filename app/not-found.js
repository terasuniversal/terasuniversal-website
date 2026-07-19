import SiteHeader from "../components/SiteHeader";
import SiteFooter from "../components/SiteFooter";

export const metadata = {
  title: "Page Not Found",
  description: "The page you are looking for could not be found on the TERAS UNIVERSAL website.",
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <main className="utility-page not-found-page">
      <SiteHeader />
      <div className="container utility-container not-found-content">
        <span className="eyebrow">404 Error</span>
        <h1>We couldn&apos;t find that page.</h1>
        <p className="utility-lead">The page you are looking for may have been moved, renamed, or no longer exists. Explore the links below to find what you need.</p>
        <div className="hero-actions">
          <a className="btn btn-primary" href="/">Return Home</a>
          <a className="btn btn-outline" href="/training">Explore Training</a>
          <a className="btn btn-outline" href="/contact">Contact Us</a>
        </div>
        <div className="not-found-links">
          <a href="/services">Services</a>
          <a href="/industries">Industries We Serve</a>
          <a href="/resources">Resources Centre</a>
          <a href="/faq">FAQ Centre</a>
          <a href="/search">Search the Site</a>
        </div>
      </div>
      <SiteFooter />
    </main>
  );
}
