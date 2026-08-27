import styles from "./public-phase-two.module.css";

const defaultOptions = [
  ["Public Programme", "Scheduled learning for individuals and employees from different organisations."],
  ["Corporate In-House Training", "A focused programme arranged for one organisation or workforce group."],
  ["Onsite Training", "Practical learning delivered at a client workplace, plant, project site or approved facility."],
  ["Competency Assessment", "Structured theoretical and practical evaluation according to programme requirements."],
];

export default function DeliveryOptions({ options = defaultOptions }) {
  return (
    <div className={styles.deliveryGrid}>
      {options.map(([title, text], index) => <article key={title}><span>{String(index + 1).padStart(2, "0")}</span><h3>{title}</h3><p>{text}</p></article>)}
    </div>
  );
}
