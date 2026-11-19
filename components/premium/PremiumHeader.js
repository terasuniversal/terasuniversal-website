import Image from "next/image";
import MegaNav from "../MegaNav";
import MobileNav from "../MobileNav";
import { companyProfile } from "../../data/companyProfile";
import { homeContent } from "../../content/en/home";
import { publicRegistrationEnabled } from "../../lib/public-registration-gate";
import kit from "./premium.module.css";
import hdr from "./header.module.css";

// Shared public header (Hybrid Premium V2, R3; structure adapted from the Premium A3 header @ 55022bf).
// A contact strip, then one navy bar with the logo, the existing MegaNav / MobileNav (menus, keyboard handling, active-page
// marking and deep links are unchanged; the kit only restyles them) and the "Register for a Course" action for individuals.
// Organisations reach corporate training through the menu's "Corporate Training" group and the hero's "Corporate Training"
// button: with the 80px logo and the full menu, a second header button does not fit the 1440px content width at any screen
// size (measured in S2C). The display email comes from data/companyProfile.js; form delivery is separate.
// `registerHref` lets the homepage point the individual action at its own session list; other pages use the calendar.
//
// Logo (owner-approved Option A, S2D): the official white vector logo from the TERAS logo pack
// (02_VECTOR/TERAS_UNIVERSAL_White.svg), copied byte for byte into public/brand/ (SHA-256 checked by
// scripts/premium-header-contract.mts). The full lockup (mark, "TERAS UNIVERSAL" and the tagline line) keeps the pack's
// 1184 x 847 ratio and is scaled with object-fit: contain, never cropped or stretched. A vector needs no resized copies,
// so next/image serves it unoptimised.
const LOGO_SRC = "/brand/teras-universal-logo-white.svg";

export default function PremiumHeader({ registerHref = "/calendar" }) {
  // Public-First F-1: never invite "Register" while public online registration is switched off; same target either way.
  const registerCta = publicRegistrationEnabled() ? homeContent.header.registerCta : homeContent.header.registerCtaClosed;
  const { email, phone } = companyProfile.contact;
  return (
    <>
      <div className={`${kit.px} ${hdr.top}`}>
        <div className={kit.wrap}>
          <span>Industrial Safety Training &amp; Technical Competency</span>
          <nav className={hdr.topLinks} aria-label="Contact">
            <a href={`tel:${phone.replace(/[^+\d]/g, "")}`}>{phone}</a>
            <a href="https://wa.me/60195193834" target="_blank" rel="noreferrer">WhatsApp<span className="sr-only"> (opens in a new tab)</span></a>
            <a href={`mailto:${email}`}>{email}</a>
          </nav>
        </div>
      </div>
      <header className={`${kit.px} ${hdr.hdr}`}>
        <div className={`${kit.wrap} ${hdr.hdrRow}`}>
          <a className={hdr.logo} href="/" aria-label="TERAS UNIVERSAL home">
            <Image src={LOGO_SRC} alt="TERAS UNIVERSAL" width={1184} height={847} unoptimized priority />
          </a>
          <MegaNav />
          {/* The visible text shortens on narrow screens; the accessible name stays the full label. */}
          <a className={`${kit.btn} ${hdr.regCta}`} href={registerHref} aria-label={registerCta.label}>
            <span className={hdr.ctaLong}>{registerCta.label}</span>
            <span className={hdr.ctaShort}>{registerCta.shortLabel}</span>
          </a>
          <MobileNav />
        </div>
      </header>
    </>
  );
}
