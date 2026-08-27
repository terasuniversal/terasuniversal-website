import styles from "./public-phase-two.module.css";

const solutions = [
  ["Industrial Safety Training", "Practical safety learning shaped around real workplace hazards, controls and task execution."],
  ["Technical Competency Development", "Structured development that connects knowledge, guided practice and job-relevant capability."],
  ["Competency Assessment", "Theoretical and practical evaluation where programme requirements call for it."],
  ["Industrial Consultancy", "Practical advisory support to identify operational weaknesses and improvement priorities."],
];

export default function IndustrySolutions() {
  return (
    <div className={styles.solutionGrid}>
      {solutions.map(([title, text], index) => <article key={title}><span>{String(index + 1).padStart(2, "0")}</span><h3>{title}</h3><p>{text}</p></article>)}
    </div>
  );
}
