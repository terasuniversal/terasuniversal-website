import Image from "next/image";
import styles from "./home.module.css";

// Wording is taken from the existing homepage delivery section.
const options = [
  ["Public programme", "Scheduled programmes for individuals and employees from different organisations."],
  ["Corporate in-house training", "Customised programmes delivered exclusively for one organisation, department or workforce group."],
  ["Onsite training", "Training conducted at the client’s workplace, plant, project site or approved operational facility."],
];

export default function DeliveryOptions() {
  return (
    <div id="delivery" className={styles.delivery}>
      <div className={styles.axis}>
        <h3 className={styles.h3Large}>How training is delivered</h3>
        <p className={styles.intro}>Public classes, or a programme built for your workforce, at our centre or at your site.</p>
      </div>
      <div className={styles.three}>
        {options.map(([title, text]) => (
          <div key={title} data-reveal><h4 className={styles.h4}>{title}</h4><p>{text}</p></div>
        ))}
      </div>
      <figure className={styles.wide}>
        <Image src="/images/v2/delivery-instructor-led-male-branded.webp" alt="An instructor holds up a scaffold coupler to a classroom of eight trainees taking notes" fill loading="lazy" sizes="100vw" />
      </figure>
    </div>
  );
}
