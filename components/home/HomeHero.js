import Image from "next/image";
import styles from "./home.module.css";

// Illustrative photography: temporary AI-generated images approved for this design slice.
export default function HomeHero() {
  return (
    <section id="home" className={styles.hero} aria-label="Introduction">
      <div className={styles.board}>
        <div className={`${styles.tile} ${styles.name}`}>
          <h1 className={styles.wordmark}>TERAS<span className="sr-only"> UNIVERSAL</span></h1>
          <p>Scaffolding erector, inspector and working at height training from Jitra, Kedah.</p>
        </div>
        <div className={`${styles.tile} ${styles.photo} ${styles.photoTop}`}>
          <Image className={styles.drift} src="/images/temp-ai-corporate-scene-05.webp" alt="Two trainees in harnesses checking scaffold fittings" fill priority sizes="(max-width: 820px) 100vw, 50vw" />
        </div>
        <div className={`${styles.tile} ${styles.photo} ${styles.photoBottom}`}>
          <Image className={styles.drift} src="/images/temp-ai-training-yard.webp" alt="Trainees in hard hats and vests at a training yard briefing" fill sizes="(max-width: 820px) 100vw, 50vw" />
        </div>
        <div className={styles.split}>
          <div className={styles.dark}>
            <p>Industrial safety and technical competency since 2012. Approved by JKKP, registered with HRD Corp and CIDB.</p>
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
