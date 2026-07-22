import Image from "next/image";

// Shared site footer — Module: Consistency pass (site-organisation feedback).
//
// Before this, the footer markup was copy-pasted into 13 separate page files,
// which had drifted into 4 slightly different variants (some missing the
// "Quick Links" column, one using an anchor link instead of the dedicated
// /contact page). This component is now the single source of truth: update
// the address, phone number, or links here once and every page picks it up.
export default function Footer() {
  return (
    <footer>
      <div className="container footer-grid">
        <div className="footer-brand">
          <Image src="/teras-universal-logo.png" alt="TERAS UNIVERSAL" width={210} height={135} sizes="190px" />
          <p>Building Competence. Creating Opportunities.</p>
        </div>
        <div>
          <h3>Core Services</h3>
          <p>Industrial Safety<br />Technical Competency<br />Industrial Consultancy<br />Workforce Development</p>
        </div>
        <div>
          <h3>Quick Links</h3>
          <p>
            <a href="/about">About</a><br />
            <a href="/training">Training</a><br />
            <a href="/services">Services</a><br />
            <a href="/contact">Contact</a><br />
            <a href="/verify">Verify Certificate</a>
          </p>
        </div>
        <div>
          <h3>Contact</h3>
          <p><a href="mailto:training@terasuniversal.com.my">training@terasuniversal.com.my</a><br /><a href="tel:+60195193834">+60 19-519 3834</a></p>
          <p>Lot 1961, Jalan Tanah Merah,<br />Kg Tanah Merah Dalam,<br />06000 Jitra, Kedah, Malaysia</p>
        </div>
      </div>
      <div className="container footer-bottom">
        <span>&copy; 2026 TERAS UNIVERSAL SDN. BHD. All rights reserved.</span>
        <span>terasuniversal.com.my</span>
      </div>
    </footer>
  );
}
