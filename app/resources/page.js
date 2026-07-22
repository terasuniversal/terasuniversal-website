import Image from "next/image";
import MobileNav from "../../components/MobileNav";
import MegaNav from "../../components/MegaNav";
import Footer from "../../components/Footer";

const resourceGroups = [
  {
    label: "Company Information",
    items: [
      { title: "Company Profile", text: "A concise overview of TERAS UNIVERSAL, our capabilities and the industries we support.", action: "Download PDF", href: "/downloads/TERAS-UNIVERSAL-Company-Profile.pdf", note: "PDF · Corporate profile" },
      { title: "About TERAS UNIVERSAL", text: "Our story, leadership, accreditations and the values behind our training.", action: "Learn more", href: "/about", note: "Company overview" },
      { title: "Industries We Serve", text: "Explore sector-specific training solutions for Oil & Gas, Construction, Manufacturing and more.", action: "View industries", href: "/industries", note: "Corporate solutions" },
    ],
  },
  {
    label: "Training Information",
    items: [
      { title: "Course Catalogue", text: "Explore industrial safety, technical competency and workforce development programmes.", action: "View training", href: "/training", note: "Online catalogue" },
      { title: "Training Calendar", text: "Browse scheduled public programmes and review current delivery windows.", action: "View calendar", href: "/calendar", note: "Upcoming sessions" },
      { title: "Frequently Asked Questions", text: "Answers to common questions about our programmes, delivery and certification.", action: "View FAQ", href: "/faq", note: "FAQ Centre" },
      { title: "Verify a Certificate", text: "Confirm the authenticity of a TERAS UNIVERSAL training certificate.", action: "Verify now", href: "/verify", note: "Certificate lookup" },
    ],
  },
  {
    label: "Corporate Engagement",
    items: [
      { title: "Corporate Enquiry Form", text: "Share your organisation's training needs and receive a suitable proposal pathway.", action: "Request proposal", href: "/request-proposal", note: "Guided enquiry" },
      { title: "Speak With Our Team", text: "Reach us directly by phone, WhatsApp or email for urgent or detailed enquiries.", action: "Contact us", href: "/contact", note: "Direct contact" },
    ],
  },
];

export const metadata = { title: "Resources", description: "TERAS UNIVERSAL corporate resources, course information, training calendar and enquiry pathways.", alternates: { canonical: "/resources" } };

export default function ResourcesPage() {
  return (
    <main className="resources-page">
      <header className="site-header">
        <div className="container nav-wrap">
          <a className="brand" href="/" aria-label="TERAS UNIVERSAL home"><Image src="/teras-universal-logo.png" alt="TERAS UNIVERSAL logo" width={220} height={140} priority sizes="154px" /></a>
          <MegaNav />
          <MobileNav basePath="/" />
        </div>
      </header>

      <section className="resources-hero"><div className="container"><span className="eyebrow">Resources Centre</span><h1>Useful information for better training decisions.</h1><p className="utility-lead">Access corporate information and training resources, or speak with our team when you need a tailored recommendation.</p></div></section>

      {resourceGroups.map((group) => (
        <section className="resources-group-section" key={group.label}>
          <div className="container">
            <div className="section-heading"><span className="eyebrow">{group.label}</span></div>
            <div className="resource-grid">
              {group.items.map(({ title, text, action, href, note }, index) => (
                <article className="resource-card" key={title}>
                  <span className="resource-number">{String(index + 1).padStart(2, "0")}</span>
                  <span className="resource-note">{note}</span>
                  <h2>{title}</h2>
                  <p>{text}</p>
                  <a href={href}>{action} <span aria-hidden="true">&rarr;</span></a>
                </article>
              ))}
            </div>
          </div>
        </section>
      ))}

      <section className="services-cta"><div className="container"><div><span className="eyebrow">Need Something Specific?</span><h2>Talk to Our Team Directly</h2></div><div className="hero-actions"><a className="btn btn-light" href="/request-proposal">Request Proposal</a><a className="btn btn-gold" href="https://wa.me/60195193834" target="_blank" rel="noreferrer">WhatsApp Us</a></div></div></section>

      <Footer />
    </main>
  );
}
