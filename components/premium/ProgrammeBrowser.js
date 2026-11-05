"use client";

import { useMemo, useState } from "react";
import { courseCatalog } from "../../data/courseCatalog";
import { enquiryHref } from "../public/PrimaryCtaGroup";
import EmptyState from "./EmptyState";
import ProgrammeRow from "./ProgrammeRow";
import kit from "./premium.module.css";
import inner from "./inner.module.css";

const bySlug = (slug) => courseCatalog.find((course) => course.slug === slug);
const categories = ["All Programmes", ...new Set(courseCatalog.map((course) => course.category))];

// Programme hierarchy: the same three groups as the homepage catalogue, in level order.
const groups = [
  { label: "Scaffolding Erector", note: "Levels 1 to 3", slugs: ["basic-scaffolder-level-1", "intermediate-scaffolder-level-2", "advanced-scaffolder-level-3"] },
  { label: "Scaffolding Inspector", note: "Basic, Intermediate and Advanced", slugs: ["scaffolding-inspector-basic", "scaffolding-inspector-intermediate", "scaffolding-inspector-advanced"] },
  { label: "Industrial Safety", note: "Safety awareness and hazard control", slugs: ["working-at-height", "confined-space-safety", "safety-passport", "lifting-awareness"] },
];

// Filter chips (same categories as before) narrow the grouped index; a course not listed in a group is never dropped.
export default function ProgrammeBrowser() {
  const [active, setActive] = useState("All Programmes");
  const inFilter = (course) => active === "All Programmes" || course.category === active;
  const visible = useMemo(() => courseCatalog.filter(inFilter), [active]); // eslint-disable-line react-hooks/exhaustive-deps
  const grouped = groups.map((group) => ({ ...group, courses: group.slugs.map(bySlug).filter((course) => course && inFilter(course)) })).filter((group) => group.courses.length > 0);
  const listed = new Set(groups.flatMap((group) => group.slugs));
  const others = visible.filter((course) => !listed.has(course.slug));

  return (
    <>
      <div className={inner.filters} role="group" aria-label="Filter training courses">
        {categories.map((category) => (
          <button key={category} type="button" className={inner.chip} aria-pressed={active === category} onClick={() => setActive(category)}>{category}</button>
        ))}
      </div>
      <p className={inner.count} aria-live="polite"><strong>{visible.length}</strong> public course{visible.length === 1 ? "" : "s"} available</p>
      {visible.length === 0 && <EmptyState title="No courses in this group yet." text="Tell us what your workforce needs and TERAS will propose a programme."><a className={`${kit.btn} ${kit.btnNavy}`} href={enquiryHref({ source: "training-catalogue" })}>Request Corporate Training</a></EmptyState>}
      {grouped.map((group) => (
        <section className={inner.group} key={group.label} aria-labelledby={`group-${group.slugs[0]}`}>
          <div className={inner.groupHead}><h3 id={`group-${group.slugs[0]}`}>{group.label}</h3><span>{group.note}</span></div>
          <ul>{group.courses.map((course) => <ProgrammeRow key={course.slug} course={course} headingLevel={4} />)}</ul>
        </section>
      ))}
      {others.length > 0 && <ul>{others.map((course) => <ProgrammeRow key={course.slug} course={course} headingLevel={4} />)}</ul>}
      <ul>
        <ProgrammeRow custom headingLevel={3} category="Custom solution" title="Custom Corporate Training" summary="Tell us about your workforce, site requirements and intended outcomes, and our team will propose a suitable arrangement." href={enquiryHref({ source: "training-catalogue" })} cta="Enquire about training" />
      </ul>
    </>
  );
}
