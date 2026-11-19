import { getImageProps } from "next/image";
import { homeContent } from "../../content/en/home";
import kit from "../premium/premium.module.css";
import styles from "./hero.module.css";

// Hybrid Premium V2 (R3) hero: one static photograph (no video), the official tagline, the headline, one supporting
// sentence and the two primary actions; phones and tablets also get a text link to the public sessions.
// The photograph (concept R1-3, phase S2E) is AI-generated and shows no TERAS personnel, facility or session, which the
// caption and the alt text say. It must not be published until the owner clears it; authentic TERAS photography replaces
// it after publication clearance.
// Art direction: phones get their own 16:10 crop (trainee and instructor fill the frame); a single CSS-cropped image
// would show the empty left half that desktop keeps free for the headline. getImageProps keeps next/image's AVIF/WebP
// optimisation for both sources. 590/591px is the phone breakpoint used by hero.module.css and globals.css.
const HERO_ALT = "AI-generated illustration: an instructor checks the chest strap of a full-body harness worn by a trainee, beside a lowered scissor lift";
const heroImage = { alt: HERO_ALT, sizes: "100vw", priority: true };
const { props: { srcSet: desktopSrcSet } } = getImageProps({ ...heroImage, src: "/images/v2/hero-r1-3-desktop.webp", width: 1672, height: 941 });
const { props: { srcSet: phoneSrcSet, ...heroImg } } = getImageProps({ ...heroImage, src: "/images/v2/hero-r1-3-phone.webp", width: 1137, height: 711 });

export default function HomeHero() {
  const { tagline, hero } = homeContent;
  return (
    <section id="home" className={`${kit.px} ${styles.hero}`} aria-labelledby="hero-title">
      <figure className={styles.media}>
        <picture>
          <source media="(min-width: 591px)" srcSet={desktopSrcSet} sizes="100vw" />
          <source media="(max-width: 590px)" srcSet={phoneSrcSet} sizes="100vw" />
          {/* alt, width, height and src come from getImageProps; it does not mark a hand-written <img> as the LCP
              image, so loading and fetchPriority are set here (QA S2F: fetchpriority was missing without them) */}
          <img {...heroImg} className={styles.img} loading="eager" fetchPriority="high" />
        </picture>
        <figcaption className={styles.note}>AI-generated illustration</figcaption>
      </figure>
      <div className={styles.shade} aria-hidden="true" />
      <div className={styles.copy}>
        <div className={kit.wrap}>
          <p className={styles.tag}>{tagline}</p>
          <h1 id="hero-title" className={styles.title}>
            {hero.title.map((line, index) => <span key={line}>{index > 0 ? " " : ""}{line}</span>)}
          </h1>
          <p className={styles.lead}>{hero.lead}</p>
          <div className={styles.acts}>
            <a className={kit.btn} href={hero.primaryCta.href}>{hero.primaryCta.label}</a>
            <a className={`${kit.btn} ${kit.btnLight}`} href={hero.secondaryCta.href}>{hero.secondaryCta.label}</a>
          </div>
          <a className={`${kit.tl} ${styles.next}`} href={hero.sessionsLink.href}>{hero.sessionsLink.label}</a>
        </div>
      </div>
    </section>
  );
}
