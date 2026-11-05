import kit from "./premium.module.css";
import inner from "./inner.module.css";

// Two-column section heading from the homepage kit: title left (with an optional small label above it), one
// supporting sentence right. `onNavy` flips the label to white for sections on the navy field.
export default function SectionHead({ id, eyebrow, title, onNavy = false, children }) {
  return (
    <div className={kit.kicker}>
      <div>
        {eyebrow && <span className={`${inner.eyebrow} ${onNavy ? "" : inner.onLight}`}>{eyebrow}</span>}
        <h2 id={id}>{title}</h2>
      </div>
      {children && <p>{children}</p>}
    </div>
  );
}
