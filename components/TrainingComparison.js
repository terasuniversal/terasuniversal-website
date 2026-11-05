"use client";

import { useMemo, useState } from "react";
import EmptyState from "./premium/EmptyState";
import inner from "./premium/inner.module.css";

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
    <>
      <div className={inner.picker} role="group" aria-label="Choose programmes to compare">
        {courses.map((course) => {
          const isOn = selected.includes(course.slug);
          const disabled = !isOn && selected.length >= MAX_SELECT;
          return <button key={course.slug} type="button" className={inner.pick} aria-pressed={isOn} disabled={disabled} onClick={() => toggle(course.slug)}>{course.title}</button>;
        })}
      </div>

      {chosen.length > 0 ? (
        <div className={inner.tableWrap} tabIndex={0} role="region" aria-label="Programme comparison table">
          <table className={inner.table}>
            <thead>
              <tr>
                <th scope="col">Programme</th>
                {chosen.map((c) => (
                  <th scope="col" key={c.slug}>
                    {c.title}
                    <a href={`/training/${c.slug}`} className={inner.viewLink}>View programme &rarr;</a>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FIELDS.map(({ key, label }) => (
                <tr key={key}>
                  <th scope="row">{label}</th>
                  {chosen.map((c) => <td key={c.slug}>{c[key] || "Available on request"}</td>)}
                </tr>
              ))}
              <tr>
                <th scope="row">Target Audience</th>
                {chosen.map((c) => (
                  <td key={c.slug}>
                    {c.audience && c.audience.length > 0 ? <ul>{c.audience.slice(0, 4).map((a) => <li key={a}>{a}</li>)}</ul> : "Available on request"}
                  </td>
                ))}
              </tr>
              <tr>
                <th scope="row">Objectives</th>
                {chosen.map((c) => (
                  <td key={c.slug}>
                    {c.objectives && c.objectives.length > 0 ? (
                      <ul>
                        {c.objectives.slice(0, 3).map((o) => <li key={o}>{o}</li>)}
                        {c.objectives.length > 3 && <li>+{c.objectives.length - 3} more</li>}
                      </ul>
                    ) : "Available on request"}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState title="No programme selected." text="Select at least one programme above to see its details." />
      )}

      <p className={inner.note}>Course information shown is limited to what has been verified in TERAS UNIVERSAL&apos;s official course catalogue. Programmes without a confirmed field show &ldquo;Available on request&rdquo; — contact our team for the latest details.</p>
    </>
  );
}
