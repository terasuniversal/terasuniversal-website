import { courseCatalog } from "../../data/courseCatalog";
import { workingAtHeightProgrammes } from "../../lib/working-at-height-programme";
import ProgrammeList from "./ProgrammeList";
import styles from "./home.module.css";

const bySlug = (slug) => courseCatalog.find((course) => course.slug === slug);

// "N Days each" only when every course in the group states the same duration.
const eachDuration = (slugs) => {
  const durations = [...new Set(slugs.map((slug) => bySlug(slug)?.duration).filter(Boolean))];
  return durations.length === 1 ? `${durations[0]} each` : "";
};

const erectorSlugs = ["basic-scaffolder-level-1", "intermediate-scaffolder-level-2", "advanced-scaffolder-level-3"];
const inspectorSlugs = ["scaffolding-inspector-basic", "scaffolding-inspector-intermediate", "scaffolding-inspector-advanced"];

// Illustrative photography: temporary AI-generated images approved for this design slice.
const items = [
  {
    // "Scaffolding Erector" is the public category label; the destination is the existing
    // Scaffolding Competency page, which this slice does not change.
    title: "Scaffolding Erector",
    href: "/training/scaffolding-competency",
    summary: "Erect, modify, inspect and dismantle scaffolding to industry standards. ",
    facts: `Basic, Intermediate and Advanced Scaffolder · ${eachDuration(erectorSlugs)}`,
    image: "/images/temp-ai-corporate-scene-07.webp",
    alt: "Scaffolder tightening a coupler on a scaffold tube",
  },
  {
    title: "Scaffolding Inspector",
    href: "/training/scaffolding-inspector-basic",
    summary: "Inspect scaffold structures against standards and report defects and corrective actions. ",
    facts: `Basic, Intermediate, Advanced · ${eachDuration(inspectorSlugs)}`,
    image: "/images/temp-ai-corporate-scene-14.webp",
    alt: "Inspectors reviewing a scaffold against a checklist",
  },
  {
    title: "Working at Height",
    href: "/training/working-at-height",
    summary: "Identify hazards, apply fall prevention and protection, and check and use PPE. ",
    facts: workingAtHeightProgrammes.working_at_height.duration_label,
    image: "/images/temp-ai-corporate-scene-12.webp",
    alt: "Trainees practising a rescue on a harnessed casualty",
  },
];

export default function CoreProgrammes() {
  return (
    <section id="programmes" className={styles.section} aria-labelledby="programmes-title">
      {/* Alias targets so existing links to #training and #services land on the programmes. */}
      <span id="training" className={styles.anchor} />
      <span id="services" className={styles.anchor} />
      <div className={styles.axis}>
        <h2 id="programmes-title" className={styles.h2}>Our core programmes</h2>
        <p className={styles.intro}>Three pathways, each assessed in theory and practice.</p>
      </div>
      <ProgrammeList items={items} />
    </section>
  );
}
