import Image from "next/image";
import MobileNav from "../components/MobileNav";
import MegaNav from "../components/MegaNav";
import Footer from "../components/Footer";

// Sitewide 404 page (Next.js App Router convention: app/not-found.js).
//
// Before this, only /verify/[certificateNo] had a custom "not found" page —
// every other broken link or mistyped URL on the site fell through to a
// generic, unbranded error screen. That's a poor first impression for a
// visitor who followed a bad link. This page keeps the full site header,
// navigation and footer so a lost visitor never leaves the TERAS UNIVERSAL
// look-and-feel, and gives them clear, useful next steps instead of a dead end.
export const metadata = {
  title: "Page Not Found",
  robots: { index: false, follow: false },
};

const quickLinks = [
  ["Homepage", "/", "Start again from the main page."],
  ["Training Programmes", "/training", "Browse all industrial safety and technical training courses."],
  ["Industries We Support", "/industries", "See sector-specific training solutions."],
  ["Search", "/search", "Search the site for what you were looking for."],
  ["Contact Us", "/contact", "Speak with our team directly."],
];

export default function NotFound() {
  return (
    <main>
      <header className="site-header">
        <div className="container nav-wrap">
          <a className="brand" href="/" aria-label="TERAS UNIVERSAL home">
            <Image src="/teras-universal-logo.png" alt="TERAS UNIVERSAL logo" width={220} height={140} priority sizes="154px" />
          </a>
          <MegaNav />
          <MobileNav />
        </div>
      </header>

      <section className="notfound-section" aria-labelledby="notfound-title">
        <div className="container notfound-inner">
          <span className="eyebrow">Error 404</span>
          <h1 id="notfound-title">We couldn&apos;t find that page.</h1>
          <p>
            The page you&apos;re looking for may have been moved, renamed, or no
            longer exists. Here are a few places that might help instead.
          </p>
          <div className="notfound-links">
            {quickLinks.map(([label, href, text]) => (
              <a className="notfound-link-card" href={href} key={href}>
                <h3>{label}</h3>
                <p>{text}</p>
              </a>
            ))}
          </div>
          <a className="btn btn-primary" href="/">Back to Homepage</a>
        </div>
      </section>

      <Footer />
    </main>
  );
}
