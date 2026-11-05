import Image from "next/image";
import MegaNav from "../MegaNav";
import MobileNav from "../MobileNav";
import kit from "./premium.module.css";

// Shared public header (Concept A3 Executive): contact bar, then one navy bar with the full menu and a single
// dominant "Request a Proposal" action. MegaNav and MobileNav are the existing navigation components; the kit
// stylesheet only restyles them, so menus, keyboard handling, active-page marking and deep links are unchanged.
// The two elements are siblings (no wrapper) so the bar can stay sticky for the whole page.
export default function PremiumHeader() {
  return (
    <>
      <div className={`${kit.px} ${kit.top}`}>
        <div className={kit.wrap}>
          <span>Industrial Safety Training &amp; Technical Competency</span>
          <nav className={kit.topLinks} aria-label="Contact">
            <a href="tel:+60195193834">+60 19-519 3834</a>
            <a href="https://wa.me/60195193834" target="_blank" rel="noreferrer">WhatsApp<span className="sr-only"> (opens in a new tab)</span></a>
            <a href="mailto:training@terasuniversal.com.my">training@terasuniversal.com.my</a>
          </nav>
        </div>
      </div>
      <header className={`${kit.px} ${kit.hdr}`}>
        <div className={`${kit.wrap} ${kit.hdrRow}`}>
          <a className={kit.logo} href="/" aria-label="TERAS UNIVERSAL home">
            <Image src="/teras-universal-logo.png" alt="TERAS UNIVERSAL" width={220} height={140} sizes="72px" />
          </a>
          <MegaNav />
          <a className={`${kit.btn} ${kit.cta}`} href="/request-proposal?source=mega-nav-cta">Request a Proposal</a>
          <MobileNav />
        </div>
      </header>
    </>
  );
}
