import Image from "next/image";
import { courseCatalog } from "../../data/courseCatalog";
import { homeContent } from "../../content/en/home";
import kit from "../premium/premium.module.css";
import home from "./home.module.css";
import styles from "./programmes.module.css";

// Hybrid Premium V2 (R3) programme cards. Titles, summaries and durations come from content/en/home.js, whose durations
// are checked against data/courseCatalog.js by scripts/home-content-contract.mts; the level names listed on each card are
// read from the catalogue here, so a renamed course updates the card. Links are the existing course routes.
// R2 S2-2: each card shows an owner-approved authentic TERAS training photograph (frozen assets, SHA-256 recorded in the
// S2-2 asset manifest). The photo data lives here, keyed by course key, because content/en/home.js is pinned by the
// Public-First launch contract. Alt text describes only what is visible: it never claims an anchorage, guardrail or
// item of equipment is secured, certified or approved, and names no equipment brand.
const PHOTOS = {
  scaffolding: {
    src: "/images/v2/course-card-scaffolding-T095.webp",
    alt: "Trainees erecting a tube-and-coupler scaffold tower during TERAS scaffolding training",
    position: "55% 45%",
    positionNarrow: "65% 30%",
  },
  inspector: {
    src: "/images/v2/course-card-inspector-T234.webp",
    alt: "A TERAS trainer and participants reviewing inspection checklists beside a training scaffold",
    position: "30% 50%",
    positionNarrow: "15% 50%",
  },
  "working-at-height": {
    src: "/images/v2/course-card-wah-T495.webp",
    alt: "Trainee wearing a full-body harness and energy-absorbing lanyard during working-at-height training",
    position: "40% 30%",
    positionNarrow: "40% 22%",
  },
};
const PHOTO_CREDIT = "Photographs: TERAS UNIVERSAL training, Kedah, Malaysia.";
const titleFor = (slug) => courseCatalog.find((course) => course.slug === slug)?.title;

export default function CoreProgrammes() {
  const { courses } = homeContent;
  return (
    <section id="programmes" className={`${kit.px} ${kit.sec} ${kit.tone}`} aria-labelledby="programmes-title">
      {/* Alias targets so existing links to #training and #services land on the programmes. */}
      <span id="training" className={home.anchor} />
      <span id="services" className={home.anchor} />
      <div className={kit.wrap}>
        <div className={styles.head}>
          <h2 id="programmes-title">{courses.title}</h2>
          <a className={kit.tl} href={courses.allLink.href}>{courses.allLink.label}</a>
        </div>
        <ul className={styles.cards}>
          {courses.items.map((item, index) => {
            const levels = item.catalogSlugs.map(titleFor).filter(Boolean);
            const duration = item.catalogSlugs.length > 1 ? `${item.duration} each` : item.duration;
            const photo = PHOTOS[item.key];
            return (
              <li className={styles.card} key={item.key}>
                <div className={styles.panel} style={photo ? { "--photo-pos": photo.position, "--photo-pos-narrow": photo.positionNarrow } : undefined}>
                  {photo && (
                    <Image className={styles.photo} src={photo.src} alt={photo.alt} fill sizes="(max-width: 599px) 100vw, (max-width: 960px) 50vw, 33vw" />
                  )}
                  {photo && <span className={styles.shade} aria-hidden="true" />}
                  <span className={photo ? `${styles.panelNo} ${styles.panelNoPhoto}` : styles.panelNo} aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                </div>
                <div className={styles.body}>
                  <h3><a className={styles.cardLink} href={item.href}>{item.title}</a></h3>
                  <p>{item.summary}</p>
                  {levels.length > 1 && <p className={styles.levels}>{levels.join(", ")}</p>}
                  <p className={styles.duration}><span>Duration</span> {duration}</p>
                  <span className={styles.more} aria-hidden="true">{courses.detailsLabel}</span>
                </div>
              </li>
            );
          })}
        </ul>
        <p className={styles.credit}>{PHOTO_CREDIT}</p>
      </div>
    </section>
  );
}
