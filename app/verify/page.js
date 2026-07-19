import Image from "next/image";
import MobileNav from "../../components/MobileNav";
import VerifyForm from "./VerifyForm";

export const metadata = {
  title: "Certificate Verification",
  description: "Verify certificates officially issued by TERAS UNIVERSAL SDN. BHD.",
};

export default function VerifyPage() {
  return (
    <main className="verify-page">
      <header className="site-header">
        <div className="container nav-wrap">
          <a className="brand" href="/" aria-label="TERAS UNIVERSAL home"><Image src="/teras-universal-logo.png" alt="TERAS UNIVERSAL logo" width={220} height={140} priority sizes="154px" /></a>
          <nav className="desktop-nav" aria-label="Main navigation">
            <a href="/about">About</a><a href="/services">Services</a><a href="/training">Training</a><a href="/#industries">Industries</a><a href="/#faq">FAQ</a><a href="/contact">Contact</a><a href="/verify" aria-current="page">Verify Certificate</a><a className="nav-proposal" href="/request-proposal">Request Proposal</a><a className="nav-cta" href="https://wa.me/60195193834" target="_blank" rel="noreferrer">WhatsApp</a>
          </nav>
          <MobileNav basePath="/" />
        </div>
      </header>

      <section className="verify-hero" aria-labelledby="verify-title">
        <div className="container verify-hero-grid">
          <div className="verify-copy"><span className="eyebrow">OFFICIAL CERTIFICATE CHECK</span><h1 id="verify-title">Certificate Verification</h1><p>Enter the certificate number to confirm that it was officially issued by TERAS UNIVERSAL SDN. BHD.</p></div>
          <div className="verify-card"><VerifyForm /><p className="verify-security" role="note"><span aria-hidden="true">▣</span> For security, verification shows only the information needed to confirm the certificate.</p></div>
        </div>
      </section>

      <footer><div className="container footer-grid"><div className="footer-brand"><Image src="/teras-universal-logo.png" alt="TERAS UNIVERSAL" width={210} height={135} sizes="190px" /><p>Building Competence. Creating Opportunities.</p></div><div><h3>Core Services</h3><p>Industrial Safety<br />Technical Competency<br />Industrial Consultancy<br />Workforce Development</p></div><div><h3>Contact</h3><p><a href="mailto:training@terasuniversal.com.my">training@terasuniversal.com.my</a><br /><a href="tel:+60195193834">+60 19-519 3834</a></p><p>Lot 1961, Jalan Tanah Merah,<br />Kg Tanah Merah Dalam,<br />06000 Jitra, Kedah, Malaysia</p></div></div><div className="container footer-bottom"><span>&copy; 2026 TERAS UNIVERSAL SDN. BHD. All rights reserved.</span><span>terasuniversal.com.my</span></div></footer>
    </main>
  );
}
