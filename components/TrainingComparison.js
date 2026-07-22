"use client";

import { useMemo, useState } from "react";

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
    <section className="training-compare-section" aria-labelledby="compare-title">
      <div className="container">
        <div className="section-heading training-section-heading">
          <span className="eyebrow">Compare Programmes</span>
          <h2 id="compare-title">Not sure which level is right for your team?</h2>
          <p>Select up to {MAX_SELECT} programmes to compare duration, delivery mode, assessment and completion side by side. All figures shown are verified against the official TERAS UNIVERSAL course catalogue.</p>
        </div>

        <div className="training-compare-picker" role="group" aria-label="Choose programmes to compare">
          {courses.map((course) => {
            const isOn = selected.includes(course.slug);
            const disabled = !isOn && selected.length >= MAX_SELECT;
            return (
              <button
                key={course.slug}
                type="button"
                className={`training-compare-chip${isOn ? " is-active" : ""}`}
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
          <div className="training-compare-table-wrap">
            <table className="training-compare-table">
              <thead>
                <tr>
                  <th scope="col" className="training-compare-rowlabel">Programme</th>
                  {chosen.map((c) => (
                    <th scope="col" key={c.slug}>
                      {c.title}
                      <a href={`/training/${c.slug}`} className="training-compare-viewlink">View programme &rarr;</a>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {FIELDS.map(({ key, label }) => (
                  <tr key={key}>
                    <th scope="row" className="training-compare-rowlabel">{label}</th>
                    {chosen.map((c) => (
                      <td key={c.slug}>{c[key] || "Available on request"}</td>
                    ))}
                  </tr>
                ))}
                <tr>
                  <th scope="row" className="training-compare-rowlabel">Target Audience</th>
                  {chosen.map((c) => (
                    <td key={c.slug}>
                      {c.audience && c.audience.length > 0 ? (
                        <ul className="training-compare-list">
                          {c.audience.slice(0, 4).map((a) => <li key={a}>{a}</li>)}
                        </ul>
                      ) : "Available on request"}
                    </td>
                  ))}
                </tr>
                <tr>
                  <th scope="row" className="training-compare-rowlabel">Objectives</th>
                  {chosen.map((c) => (
                    <td key={c.slug}>
                      {c.objectives && c.objectives.length > 0 ? (
                        <ul className="training-compare-list">
                          {c.objectives.slice(0, 3).map((o) => <li key={o}>{o}</li>)}
                          {c.objectives.length > 3 && <li className="training-compare-more">+{c.objectives.length - 3} more</li>}
                        </ul>
                      ) : "Available on request"}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <p className="training-compare-empty">Select at least one programme above to see its details.</p>
        )}

        <p className="training-compare-note">Course information shown is limited to what has been verified in TERAS UNIVERSAL&apos;s official course catalogue. Programmes without a confirmed field show &ldquo;Available on request&rdquo; — contact our team for the latest details.</p>
      </div>
    </section>
  );
}
