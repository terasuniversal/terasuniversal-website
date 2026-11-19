import Image from "next/image";
import PremiumHeader from "../../components/premium/PremiumHeader";
import { publicBody } from "../../components/premium/fonts";
import kit from "../../components/premium/premium.module.css";
import styles from "../../components/training/training.module.css";
import CourseCatalogue from "../../components/training/CourseCatalogue";
import TrainingFinder from "../../components/TrainingFinder";
import TrainingComparison from "../../components/TrainingComparison";
import PremiumFooter from "../../components/premium/PremiumFooter";
import { trainingContent } from "../../content/en/training";
import { courseCatalog, comparableCourses } from "../../data/courseCatalog";

// Hybrid Premium V2 training catalogue (Phase S4C). A server page: the shared Premium Navy header, a navy hero, the
// training finder, the course catalogue with its category filter (client component), the programme comparison, the
// delivery options and the corporate enquiry. Every course comes from data/courseCatalog.js; nothing is hard-coded here.
// Metadata stays in app/training/layout.js.
export default function TrainingPage() {
  const { slogan, hero, delivery, corporate } = trainingContent;
  return (
    <>
      <PremiumHeader />
      <main className={publicBody.variable}>
        <section className={`${kit.px} ${kit.navyField} ${styles.hero}`} aria-labelledby="training-hero-title">
          <div className={`${kit.wrap} ${styles.heroGrid}`}>
            <div>
              <p className={styles.slogan}>{slogan}</p>
              <p className={styles.heroEyebrow}>{hero.eyebrow}</p>
              <h1 id="training-hero-title" className={styles.title}>{hero.title}</h1>
              <p className={styles.lead}>{hero.lead}</p>
              <div className={styles.acts}>
                <a className={kit.btn} href={hero.primary.href}>{hero.primary.label}</a>
                <a className={`${kit.btn} ${kit.btnLight}`} href={hero.secondary.href}>{hero.secondary.label}</a>
              </div>
              <ul className={styles.features} aria-label={hero.featuresLabel}>{hero.features.map((feature) => <li key={feature}>{feature}</li>)}</ul>
            </div>
            <figure className={styles.figure}>
              <Image src={hero.image.src} alt={hero.image.alt} style={{ objectPosition: "12% 40%" }} width={1200} height={800} priority sizes="(max-width: 960px) 100vw, 45vw" />
              <figcaption className={styles.note}>{hero.image.caption}</figcaption>
            </figure>
          </div>
        </section>
        <TrainingFinder />
        <CourseCatalogue courses={courseCatalog} />
        <TrainingComparison courses={comparableCourses()} />
        <section className={`${kit.px} ${kit.sec} ${styles.delivery}`} aria-labelledby="delivery-title">
          <div className={kit.wrap}>
            <p className={styles.eyebrow}>{delivery.eyebrow}</p>
            <h2 id="delivery-title">{delivery.title}</h2>
            <p className={styles.sectionText}>{delivery.text}</p>
            <ol className={styles.deliveryGrid}>
              {delivery.options.map(([number, title, text]) => <li key={title}><span aria-hidden="true">{number}</span><h3>{title}</h3><p>{text}</p></li>)}
            </ol>
          </div>
        </section>
        <section className={`${kit.px} ${kit.sec} ${kit.navyField}`} aria-labelledby="training-corporate-title">
          <div className={`${kit.wrap} ${styles.corporate}`}>
            <div>
              <p className={styles.heroEyebrow}>{corporate.eyebrow}</p>
              <h2 id="training-corporate-title">{corporate.title}</h2>
              <p className={styles.corporateText}>{corporate.text}</p>
            </div>
            <div className={styles.acts}>
              <a className={kit.btn} href={corporate.primary.href}>{corporate.primary.label}</a>
              <a className={`${kit.btn} ${kit.btnLight}`} href={corporate.whatsapp.href} target="_blank" rel="noreferrer">{corporate.whatsapp.label}</a>
            </div>
          </div>
        </section>
      </main>
        <PremiumFooter />
    </>
  );
}
