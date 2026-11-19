import { getImageProps } from "next/image";
import { homeContent } from "../../content/en/home";
import kit from "../premium/premium.module.css";
import styles from "./hero.module.css";

// Hybrid Premium V2, Release 2 (S1) hero: one static illustration (no video), the official tagline, the headline, one
// supporting sentence and the two primary actions; phones and tablets also get a text link to the public sessions.
// The illustration (concept V3-R-2, ring-corrected source SHA-256 9ac58e9a…2516) is AI-generated: it shows no TERAS
// personnel, and the refinery is not a TERAS-owned or client-owned facility, which the caption and the alt text say.
// Owner design approval and owner-confirmed HSE approval were recorded on 19 Nov 2026 in the design workspace.
// Art direction: three sources, because one CSS crop cannot keep the whole scaffold-free scene on wide screens and still
// fill a phone: desktop shows the whole 16:9 picture beside the copy, tablets a right-hand crop beside the copy, phones a
// 5:4 crop above it. getImageProps keeps next/image's AVIF/WebP optimisation for every source. 700/701px and 1180/1181px
// are the breakpoints used by hero.module.css.
const HERO_ALT = "AI-generated illustration: two industrial workers in navy coveralls, helmets with ear defenders and safety glasses stand on a marked walkway looking out over a refinery at dusk. Not a TERAS-owned or client-owned facility.";
const heroImage = { alt: HERO_ALT, sizes: "100vw", priority: true };
const { props: { srcSet: desktopSrcSet } } = getImageProps({ ...heroImage, src: "/images/v2/hero-v3r2-desktop.webp", width: 1672, height: 941 });
const { props: { srcSet: tabletSrcSet } } = getImageProps({ ...heroImage, src: "/images/v2/hero-v3r2-tablet.webp", width: 900, height: 862 });
const { props: { srcSet: phoneSrcSet, ...heroImg } } = getImageProps({ ...heroImage, src: "/images/v2/hero-v3r2-phone.webp", width: 900, height: 720 });

export default function HomeHero() {
  const { tagline, hero } = homeContent;
  return (
    <section id="home" className={`${kit.px} ${styles.hero}`} aria-labelledby="hero-title">
      <figure className={styles.media}>
        <picture>
          <source media="(min-width: 1181px)" srcSet={desktopSrcSet} sizes="86vw" />
          <source media="(min-width: 701px) and (max-width: 1180px)" srcSet={tabletSrcSet} sizes="52vw" />
          <source media="(max-width: 700px)" srcSet={phoneSrcSet} sizes="100vw" />
          {/* alt, width, height and src come from getImageProps; it does not mark a hand-written <img> as the LCP
              image, so loading and fetchPriority are set here (QA S2F: fetchpriority was missing without them) */}
          <img {...heroImg} className={styles.img} loading="eager" fetchPriority="high" />
        </picture>
        <figcaption className={styles.note}>AI-generated illustration — not a TERAS-owned or client-owned facility</figcaption>
      </figure>
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
