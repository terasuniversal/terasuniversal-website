import { Fragment } from "react";
import { courseCatalog } from "../../data/courseCatalog";
import { workingAtHeightProgrammes } from "../../lib/working-at-height-programme";
import kit from "../premium/premium.module.css";
import styles from "./home.module.css";

const bySlug = (slug) => courseCatalog.find((course) => course.slug === slug);

// "N Days each" only when every course in the group states the same duration.
const eachDuration = (slugs) => {
  const durations = [...new Set(slugs.map((slug) => bySlug(slug)?.duration).filter(Boolean))];
  return durations.length === 1 ? `${durations[0]} each` : "";
};

const erectorSlugs = ["basic-scaffolder-level-1", "intermediate-scaffolder-level-2", "advanced-scaffolder-level-3"];
const inspectorSlugs = ["scaffolding-inspector-basic", "scaffolding-inspector-intermediate", "scaffolding-inspector-advanced"];

// Wording and facts are the existing homepage values; they are only laid out as labelled rows.
const items = [
  {
    // "Scaffolding Erector" is the public category label; the destination is the existing
    // Scaffolding Competency page, which this slice does not change.
    title: "Scaffolding Erector",
    href: "/training/scaffolding-competency",
    summary: "Erect, modify, inspect and dismantle scaffolding to industry standards.",
    facts: [["Levels", "Basic, Intermediate and Advanced Scaffolder"], ["Length", eachDuration(erectorSlugs)]],
  },
  {
    title: "Scaffolding Inspector",
    href: "/training/scaffolding-inspector-basic",
    summary: "Inspect scaffold structures against standards and report defects and corrective actions.",
    facts: [["Levels", "Basic, Intermediate, Advanced"], ["Length", eachDuration(inspectorSlugs)]],
  },
  {
    title: "Working at Height",
    href: "/training/working-at-height",
    summary: "Identify hazards, apply fall prevention and protection, and check and use PPE.",
    facts: [["Format", workingAtHeightProgrammes.working_at_height.duration_label]],
  },
];

export default function CoreProgrammes() {
  return (
    <section id="programmes" className={kit.sec} aria-labelledby="programmes-title">
      {/* Alias targets so existing links to #training and #services land on the programmes. */}
      <span id="training" className={styles.anchor} />
      <span id="services" className={styles.anchor} />
      <div className={kit.wrap}>
        <div className={kit.kicker}>
          <h2 id="programmes-title">Our core programmes</h2>
          <p>Three pathways, each assessed in theory and practice.</p>
        </div>
        <ol className={kit.idx}>
          {items.map((item, index) => (
            <li className={kit.row} key={item.href}>
              <span className={kit.no} aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
              <h3><a className={kit.rowLink} href={item.href}>{item.title}</a></h3>
              <p>{item.summary}</p>
              <dl className={kit.facts}>
                {item.facts.filter(([, value]) => value).map(([label, value]) => (
                  <Fragment key={label}><dt>{label}</dt><dd>{value}</dd></Fragment>
                ))}
              </dl>
              <span className={kit.go} aria-hidden="true">View programme <span>&rarr;</span></span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
