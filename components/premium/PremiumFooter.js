import Image from "next/image";
import { publicContact } from "../../data/publicContact";
import { footerContent } from "../../content/en/footer";
import { privacyPublished } from "../../lib/privacy-publication";
import { publicBody } from "./fonts";
import kit from "./premium.module.css";
import styles from "./footer.module.css";

// Premium public footer (Hybrid Premium V2, Phase S4D-2D). A separate component rather than a restyle of
// components/Footer.js, because that shared footer is also rendered by the registration page, the 404 page and the
// dead app/verify/page.js, which stay outside this phase. Server component: no client JavaScript.
// The logo is the official white vector from the TERAS logo pack (the same file the Premium header uses, SHA-256 checked
// by scripts/premium-header-contract.mts), shown whole at its 1184 x 847 ratio and never cropped or stretched.
// publicBody.variable is set here because pages outside the Premium set do not define the Inter variable themselves.
const LOGO_SRC = "/brand/teras-universal-logo-white.svg";

export default function PremiumFooter() {
  const text = footerContent;
  const { email, phone } = publicContact;
  const tel = phone.replace(/[^+\d]/g, "");
  // Server component: the year is computed on the server in Malaysia time, so there is no client clock and no
  // hydration mismatch. Statically generated pages take the year at build time.
  const year = new Intl.DateTimeFormat("en-MY", { year: "numeric", timeZone: "Asia/Kuala_Lumpur" }).format(new Date());
  return (
    <footer className={`${kit.px} ${styles.footer} ${publicBody.variable}`}>
      <div className={`${kit.wrap} ${styles.grid}`}>
        <div className={styles.brand}>
          <a className={styles.logo} href="/" aria-label={text.homeLabel}>
            <Image src={LOGO_SRC} alt={text.logoAlt} width={1184} height={847} unoptimized />
          </a>
          <p className={styles.company}>{text.company}</p>
          <p className={styles.slogan}>{text.slogan}</p>
          <div className={styles.actions}>
            <a className={`${kit.btn} ${styles.action}`} href={text.actions.whatsapp.href} target="_blank" rel="noreferrer">
              {text.actions.whatsapp.label}<span className="sr-only"> {text.actions.whatsapp.newTab}</span>
            </a>
            <a className={`${kit.btn} ${kit.btnLight} ${styles.action}`} href={`mailto:${email}`}>{text.actions.email.label}</a>
          </div>
        </div>
        {text.groups.map((group) => (
          <nav className={styles.group} aria-labelledby={group.id} key={group.id}>
            <h2 id={group.id} className={styles.heading}><span>{group.title}</span></h2>
            <ul className={styles.links}>
              {group.links.map(([label, href]) => <li key={href}><a href={href}>{label}</a></li>)}
            </ul>
          </nav>
        ))}
        <div className={`${styles.group} ${styles.contactGroup}`}>
          <h2 id={text.contact.id} className={styles.heading}><span>{text.contact.title}</span></h2>
          <address className={styles.contact}>
            <p><span className={styles.label}>{text.contact.emailLabel}</span><a href={`mailto:${email}`}>{email}</a></p>
            <p><span className={styles.label}>{text.contact.phoneLabel}</span><a href={`tel:${tel}`}>{text.contact.phoneDisplay}</a></p>
            <p><span className={styles.label}>{text.contact.websiteLabel}</span><span>{text.contact.website}</span></p>
            <p className={styles.address}>{text.contact.address.map((line) => <span key={line}>{line}</span>)}</p>
          </address>
        </div>
      </div>
      <div className={styles.bottom}>
        <div className={`${kit.wrap} ${styles.bottomRow}`}>
          <p>{text.copyright(year)}</p>
          {privacyPublished && <p><a className={styles.legal} href={text.privacyLink.href}>{text.privacyLink.label}</a></p>}
          <p>{text.aiNote}</p>
        </div>
      </div>
    </footer>
  );
}
