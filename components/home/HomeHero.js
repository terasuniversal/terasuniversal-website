import Image from "next/image";
import { heroFact } from "./recognitionStatus";
import kit from "../premium/premium.module.css";
import styles from "./home.module.css";

// Illustrative photography: the two accepted AI-generated, male-only branded images, each used once on the page.
export default function HomeHero() {
  return (
    <section id="home" className={styles.board} aria-label="Introduction">
      <div className={`${styles.tile} ${styles.name}`}>
        <h1 className={styles.wordmark}>TERAS <small>UNIVERSAL</small><span className="sr-only">: scaffolding erector, inspector and working at height training</span></h1>
        <p>Scaffolding erector, inspector and working at height training from Jitra, Kedah.</p>
      </div>
      <div className={`${styles.tile} ${styles.photo} ${styles.photoTop}`}>
        <Image className={styles.drift} src="/images/v2/delivery-instructor-led-male-branded.webp" alt="An instructor holds up a scaffold coupler to a classroom of trainees taking notes" fill priority sizes="50vw" />
      </div>
      <div className={`${styles.tile} ${styles.photo} ${styles.photoBottom}`}>
        <Image className={styles.drift} src="/images/v2/hero-training-briefing-male-branded.webp" alt="An instructor briefing six trainees in navy workwear, white hard hats and hi-vis vests in a covered training hall with scaffold tubes racked behind them" fill sizes="50vw" />
      </div>
      <div className={styles.split}>
        <div className={styles.dark}>
          <p>{heroFact()}</p>
          <a className={kit.btn} href="/request-proposal?source=homepage-hero">Request a Proposal</a>
        </div>
        <div className={styles.accent}>
          <h2>Start with a course</h2>
          <a href="#programmes">Scaffolding Erector <span aria-hidden="true">&rarr;</span></a>
          <a href="#programmes">Scaffolding Inspector <span aria-hidden="true">&rarr;</span></a>
          <a href="#programmes">Working at Height <span aria-hidden="true">&rarr;</span></a>
          <a className={styles.all} href="/training">Explore all training</a>
        </div>
      </div>
    </section>
  );
}
