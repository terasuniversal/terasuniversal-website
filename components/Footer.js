import Image from "next/image";
import kit from "./premium/premium.module.css";

// Shared site footer (Concept A3 Executive), the single source of truth for the address, phone number and links.
// It sits on the same navy field as the homepage closing contact block and uses the same wrapper as the header.
export default function Footer() {
  return (
    <footer className={`${kit.px} ${kit.ftr}`}>
      <div className={kit.wrap}>
        <div className={kit.fgrid}>
          <div>
            <span className={kit.fPlate}>
              <Image src="/teras-universal-logo.png" alt="TERAS UNIVERSAL" width={210} height={135} sizes="88px" />
            </span>
            <p className={kit.tag}>Building Competence. Creating Opportunities.</p>
            <a className={`${kit.btn} ${kit.btnLight}`} href="https://wa.me/60195193834" target="_blank" rel="noreferrer">WhatsApp us <span aria-hidden="true">&rarr;</span><span className="sr-only"> (opens in a new tab)</span></a>
          </div>
          <div>
            <h3>Core Services</h3>
            <ul>
              <li><a href="/services#safety">Industrial Safety</a></li>
              <li><a href="/services#technical">Technical Competency</a></li>
              <li><a href="/services#consultancy">Industrial Consultancy</a></li>
              <li><a href="/services#workforce">Workforce Development</a></li>
            </ul>
          </div>
          <div>
            <h3>Quick Links</h3>
            <ul>
              <li><a href="/about">About</a></li>
              <li><a href="/training">Training</a></li>
              <li><a href="/services">Services</a></li>
              <li><a href="/contact">Contact</a></li>
              <li><a href="/verify">Verify Certificate</a></li>
            </ul>
          </div>
          <div>
            <h3>Contact</h3>
            <ul>
              <li><a href="mailto:training@terasuniversal.com.my">training@terasuniversal.com.my</a></li>
              <li><a href="tel:+60195193834">+60 19-519 3834</a></li>
            </ul>
            <p className={kit.fAddr}>Lot 1961, Jalan Tanah Merah,<br />Kg Tanah Merah Dalam,<br />06000 Jitra, Kedah, Malaysia</p>
          </div>
        </div>
        <div className={kit.legal}>
          <div className={kit.legalRow}>
            <span>&copy; {new Date().getFullYear()} TERAS UNIVERSAL SDN. BHD. All rights reserved.</span>
            <span>terasuniversal.com.my</span>
          </div>
          <p>Imagery on this website includes AI-generated illustrations. The people shown are not TERAS personnel.</p>
        </div>
      </div>
    </footer>
  );
}
