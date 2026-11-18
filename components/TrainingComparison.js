"use client";

import { useMemo, useState } from "react";
import kit from "./premium/premium.module.css";
import styles from "./training/training.module.css";

const MAX_SELECT = 3;
const FIELDS = [
  { key: "duration", label: "Duration" },
  { key: "deliveryMode", label: "Delivery Mode" },
  { key: "assessment", label: "Assessment" },
  { key: "completion", label: "Completion" },
];

/**
 * Reusable training comparison tool (Module 22).
 *
 * Only renders courses passed in via `courses` — the caller is responsible
 * for filtering to programmes with a fully verified spec sheet (duration,
 * objectives, assessment, delivery mode, completion all confirmed). This
 * component never fabricates a field: if a course is missing one, it shows
 * "Available on request" rather than guessing.
 */
export default function TrainingComparison({ courses }) {
  const [selected, setSelected] = useState(() => courses.slice(0, 2).map((c) => c.slug));

  const chosen = useMemo(
    () => selected.map((slug) => courses.find((c) => c.slug === slug)).filter(Boolean),
    [selected, courses]
  );

  const toggle = (slug) => {
    setSelected((current) => {
      if (current.includes(slug)) return current.filter((s) => s !== slug);
      if (current.length >= MAX_SELECT) return current;
      return [...current, slug];
    });
  };

  return (
    // Phase S4C: Premium V2 presentation (module classes); selection rules, fields and wording are unchanged.
    <section className={`${kit.px} ${kit.sec} ${styles.compare}`} aria-labelledby="compare-title">
      <div className={kit.wrap}>
        <div className={styles.compareHead}>
          <p className={styles.eyebrow}>Compare Programmes</p>
          <h2 id="compare-title">Not sure which level is right for your team?</h2>
          <p>Select up to {MAX_SELECT} programmes to compare duration, delivery mode, assessment and completion side by side. All figures shown are verified against the official TERAS UNIVERSAL course catalogue.</p>
        </div>

        <div className={styles.picker} role="group" aria-label="Choose programmes to compare">
          {courses.map((course) => {
            const isOn = selected.includes(course.slug);
            const disabled = !isOn && selected.length >= MAX_SELECT;
            return (
              <button
                key={course.slug}
                type="button"
                className={isOn ? styles.chipOn : ""}
                aria-pressed={isOn}
                disabled={disabled}
                onClick={() => toggle(course.slug)}
              >
                {course.title}
              </button>
            );
          })}
        </div>

        {chosen.length > 0 ? (
          <div className={styles.tableWrap} tabIndex={0} role="region" aria-labelledby="compare-title">
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col" className={styles.rowLabel}>Programme</th>
                  {chosen.map((c) => (
                    <th scope="col" key={c.slug}>
                      {c.title}
                      <a href={`/training/${c.slug}`} className={styles.viewLink} aria-label={`View programme: ${c.title}`}>View programme &rarr;</a>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {FIELDS.map(({ key, label }) => (
                  <tr key={key}>
                    <th scope="row" className={styles.rowLabel}>{label}</th>
                    {chosen.map((c) => (
                      <td key={c.slug}>{c[key] || "Available on request"}</td>
                    ))}
                  </tr>
                ))}
                <tr>
                  <th scope="row" className={styles.rowLabel}>Target Audience</th>
                  {chosen.map((c) => (
                    <td key={c.slug}>
                      {c.audience && c.audience.length > 0 ? (
                        <ul className={styles.compareList}>
                          {c.audience.slice(0, 4).map((a) => <li key={a}>{a}</li>)}
                        </ul>
                      ) : "Available on request"}
                    </td>
                  ))}
                </tr>
                <tr>
                  <th scope="row" className={styles.rowLabel}>Objectives</th>
                  {chosen.map((c) => (
                    <td key={c.slug}>
                      {c.objectives && c.objectives.length > 0 ? (
                        <ul className={styles.compareList}>
                          {c.objectives.slice(0, 3).map((o) => <li key={o}>{o}</li>)}
                          {c.objectives.length > 3 && <li className={styles.compareMore}>+{c.objectives.length - 3} more</li>}
                        </ul>
                      ) : "Available on request"}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <p className={styles.compareEmpty}>Select at least one programme above to see its details.</p>
        )}

        <p className={styles.compareNote}>Course information shown is limited to what has been verified in TERAS UNIVERSAL&apos;s official course catalogue. Programmes without a confirmed field show &ldquo;Available on request&rdquo; — contact our team for the latest details.</p>
      </div>
    </section>
  );
}
