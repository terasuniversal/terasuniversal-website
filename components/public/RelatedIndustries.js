import { industries } from "../../data/industries";
import styles from "./public-phase-one.module.css";

export default function RelatedIndustries({ courseSlug }) {
  const relatedIndustries = industries.filter((industry) => industry.relevantCourseSlugs.includes(courseSlug));

  if (relatedIndustries.length === 0) return null;

  return (
    <section className={styles.relatedIndustries} aria-labelledby="related-industries-title">
      <div className="container">
        <div className="section-heading">
          <span className="eyebrow">Industry Context</span>
          <h2 id="related-industries-title">Explore relevant industry solutions.</h2>
          <p>See how TERAS connects this programme to the operating needs of the sectors it supports.</p>
        </div>
        <div className={styles.relatedIndustryGrid}>
          {relatedIndustries.map((industry) => (
            <a className={styles.relatedIndustryCard} href={`/industries/${industry.slug}`} key={industry.slug}>
              <span className="eyebrow">Industry</span>
              <h3>{industry.name}</h3>
              <p>{industry.summary}</p>
              <span>Explore solutions <span aria-hidden="true">&rarr;</span></span>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
