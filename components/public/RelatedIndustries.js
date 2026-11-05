import { industries } from "../../data/industries";
import SectionHead from "../premium/SectionHead";
import kit from "../premium/premium.module.css";
import inner from "../premium/inner.module.css";

export default function RelatedIndustries({ courseSlug }) {
  const relatedIndustries = industries.filter((industry) => industry.relevantCourseSlugs.includes(courseSlug));

  if (relatedIndustries.length === 0) return null;

  return (
    <section className={kit.sec} aria-labelledby="related-industries-title">
      <div className={kit.wrap}>
        <SectionHead id="related-industries-title" title="Explore relevant industry solutions.">See how TERAS connects this programme to the operating needs of the sectors it supports.</SectionHead>
        <ul className={inner.tiles}>
          {relatedIndustries.map((industry) => (
            <li className={inner.tile} key={industry.slug}>
              <span className={inner.cat}>Industry</span>
              <h3><a className={inner.stretch} href={`/industries/${industry.slug}`}>{industry.name}</a></h3>
              <p>{industry.summary}</p>
              <span className={inner.tileGo} aria-hidden="true">Explore solutions &rarr;</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
