"use client";

import { useMemo, useState } from "react";
import { courseCatalog, courseHref } from "../data/courseCatalog";

const MAX_SELECTION = 4;
const DEFAULT_SLUGS = courseCatalog.slice(0, 3).map((course) => course.slug);

export default function TrainingComparison() {
  const [selected, setSelected] = useState(DEFAULT_SLUGS);

  const toggle = (slug) => {
    setSelected((current) => {
      if (current.includes(slug)) return current.filter((item) => item !== slug);
      if (current.length >= MAX_SELECTION) return current;
      return [...current, slug];
    });
  };

  const compared = useMemo(
    () => courseCatalog.filter((course) => selected.includes(course.slug)),
    [selected]
  );

  return (
    <div className="comparison-tool">
      <div className="comparison-picker" role="group" aria-label="Choose programmes to compare">
        {courseCatalog.map((course) => {
          const isChecked = selected.includes(course.slug);
          return (
            <label className={`comparison-chip ${isChecked ? "is-checked" : ""}`} key={course.slug}>
              <input
                type="checkbox"
                checked={isChecked}
                onChange={() => toggle(course.slug)}
                disabled={!isChecked && selected.length >= MAX_SELECTION}
              />
              {course.title}
            </label>
          );
        })}
      </div>
      <p className="comparison-hint">Select up to {MAX_SELECTION} programmes. Only confirmed course details are shown &mdash; duration and scope may still be tailored to your organisation.</p>

      {compared.length < 2 ? (
        <p className="comparison-empty">Choose at least two programmes above to compare them side by side.</p>
      ) : (
        <div className="comparison-table-wrap">
          <table className="comparison-table">
            <thead>
              <tr>
                <th scope="col">Programme</th>
                {compared.map((course) => <th scope="col" key={course.slug}>{course.title}</th>)}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Category</th>
                {compared.map((course) => <td key={course.slug}>{course.category}</td>)}
              </tr>
              <tr>
                <th scope="row">Duration</th>
                {compared.map((course) => <td key={course.slug}>{course.duration}</td>)}
              </tr>
              <tr>
                <th scope="row">Target Audience</th>
                {compared.map((course) => <td key={course.slug}><ul>{course.audience.map((item) => <li key={item}>{item}</li>)}</ul></td>)}
              </tr>
              <tr>
                <th scope="row">Learning Objectives</th>
                {compared.map((course) => <td key={course.slug}><ul>{course.objectives.map((item) => <li key={item}>{item}</li>)}</ul></td>)}
              </tr>
              <tr>
                <th scope="row">Delivery Mode</th>
                {compared.map((course) => <td key={course.slug}>{course.deliveryMode.join(", ")}</td>)}
              </tr>
              <tr>
                <th scope="row">Assessment</th>
                {compared.map((course) => <td key={course.slug}>{course.assessment}</td>)}
              </tr>
              <tr>
                <th scope="row">Completion</th>
                {compared.map((course) => <td key={course.slug}>{course.completion}</td>)}
              </tr>
              <tr>
                <th scope="row">Details</th>
                {compared.map((course) => <td key={course.slug}><a href={courseHref(course)}>View programme <span aria-hidden="true">&rarr;</span></a></td>)}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
