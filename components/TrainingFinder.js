"use client";

import { useMemo, useState } from "react";
import kit from "./premium/premium.module.css";
import inner from "./premium/inner.module.css";

const recommendations = {
  "Oil & Gas": ["Working at Height", "Confined Space Safety", "Safety Passport"],
  Construction: ["Scaffolding Competency", "Working at Height", "Lifting Awareness"],
  Manufacturing: ["Machinery Safety", "PPE & Workplace Safety", "Competency Assessment"],
  Marine: ["Working at Height", "Confined Space Safety", "Competency Assessment"],
};

export default function TrainingFinder() {
  const [answers, setAnswers] = useState({ industry: "Construction", role: "Supervisor", experience: "Some experience", objective: "Improve safety" });
  const results = useMemo(() => recommendations[answers.industry] || recommendations.Construction, [answers.industry]);
  const update = (key) => (event) => setAnswers((current) => ({ ...current, [key]: event.target.value }));

  return (
    <div className={inner.finder}>
      <div>
        <div className={inner.finderForm}>
          <label>Industry<select value={answers.industry} onChange={update("industry")}><option>Construction</option><option>Oil &amp; Gas</option><option>Manufacturing</option><option>Marine</option></select></label>
          <label>Job role<select value={answers.role} onChange={update("role")}><option>Supervisor</option><option>Operator</option><option>Safety Personnel</option><option>Technical Team</option></select></label>
          <label>Experience<select value={answers.experience} onChange={update("experience")}><option>New to the role</option><option>Some experience</option><option>Experienced</option></select></label>
          <label>Training objective<select value={answers.objective} onChange={update("objective")}><option>Improve safety</option><option>Build technical skills</option><option>Prepare for assessment</option><option>Develop supervisors</option></select></label>
        </div>
      </div>
      <div className={inner.pathway} aria-live="polite"><span className={inner.eyebrow}>Suggested pathway</span><h3>{answers.industry} workforce focus</h3><p>Based on your answers, consider starting with:</p><ul>{results.map((result) => <li key={result}>{result}</li>)}</ul><a className={kit.btn} href="/request-proposal">Discuss this pathway <span aria-hidden="true">&rarr;</span></a></div>
    </div>
  );
}
