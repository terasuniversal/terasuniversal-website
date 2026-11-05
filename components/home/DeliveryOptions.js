import kit from "../premium/premium.module.css";

// Wording is taken from the existing homepage delivery section.
const options = [
  ["Public programme", "Scheduled programmes for individuals and employees from different organisations."],
  ["Corporate in-house training", "Customised programmes delivered exclusively for one organisation, department or workforce group."],
  ["Onsite training", "Training conducted at the client’s workplace, plant, project site or approved operational facility."],
];

export default function DeliveryOptions() {
  return (
    <section id="delivery" className={`${kit.sec} ${kit.band}`} aria-labelledby="delivery-title">
      <div className={kit.wrap}>
        <div className={kit.kicker}>
          <h2 id="delivery-title">How training is delivered</h2>
          <p>Public classes, or a programme built for your workforce, at our centre or at your site.</p>
        </div>
        <ul className={kit.modes}>
          {options.map(([title, text], index) => (
            <li className={kit.mode} key={title}>
              <b aria-hidden="true">{String.fromCharCode(65 + index)}</b>
              <h3>{title}</h3>
              <p>{text}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
