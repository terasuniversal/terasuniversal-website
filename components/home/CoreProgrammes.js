import { courseCatalog } from "../../data/courseCatalog";
import { homeContent } from "../../content/en/home";
import kit from "../premium/premium.module.css";
import home from "./home.module.css";
import styles from "./programmes.module.css";

// Hybrid Premium V2 (R3) programme cards. Titles, summaries and durations come from content/en/home.js, whose durations
// are checked against data/courseCatalog.js by scripts/home-content-contract.mts; the level names listed on each card are
// read from the catalogue here, so a renamed course updates the card. Links are the existing course routes.
// No approved photograph exists for any programme yet, so each card carries the Navy/Gold panel already used on the live
// site (decorative, hidden from assistive technology). A photograph needs publication clearance first.
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
            return (
              <li className={styles.card} key={item.key}>
                <div className={styles.panel} aria-hidden="true">
                  <span className={styles.panelNo}>{String(index + 1).padStart(2, "0")}</span>
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
      </div>
    </section>
  );
}
