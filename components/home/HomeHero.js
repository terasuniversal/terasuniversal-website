import Image from "next/image";
import { heroFact } from "./recognitionStatus";
import styles from "./home.module.css";

// Illustrative photography: temporary AI-generated images approved for this design slice.
export default function HomeHero() {
  return (
    <section id="home" className={styles.hero} aria-label="Introduction">
      <div className={styles.board}>
        <div className={`${styles.tile} ${styles.name}`}>
          <h1 className={styles.wordmark}>TERAS<span className="sr-only"> UNIVERSAL: scaffolding erector, inspector and working at height training</span></h1>
          <p>Scaffolding erector, inspector and working at height training from Jitra, Kedah.</p>
        </div>
        <div className={`${styles.tile} ${styles.photo} ${styles.photoTop}`}>
          <Image className={styles.drift} src="/images/v2/delivery-instructor-led-male-branded.webp" alt="An instructor holds up a scaffold coupler to a classroom of trainees taking notes" fill priority sizes="(max-width: 820px) 100vw, 50vw" />
        </div>
        <div className={`${styles.tile} ${styles.photo} ${styles.photoBottom}`}>
          <Image className={styles.drift} src="/images/v2/hero-training-briefing-male-branded.webp" alt="An instructor briefing six trainees in navy workwear, white hard hats and hi-vis vests in a covered training hall with scaffold tubes racked behind them" fill sizes="(max-width: 820px) 100vw, 50vw" />
        </div>
        <div className={styles.split}>
          <div className={styles.dark}>
            <p>{heroFact()}</p>
            <a className={styles.heroButton} href="/request-proposal?source=homepage-hero">Request a proposal</a>
          </div>
          <div className={styles.accent}>
            <h2>Start with a course</h2>
            <a href="#programmes">Scaffolding Erector</a>
            <a href="#programmes">Scaffolding Inspector</a>
            <a href="#programmes">Working at Height</a>
            <a className={styles.allLink} href="/training">Explore all training</a>
          </div>
        </div>
      </div>
    </section>
  );
}
