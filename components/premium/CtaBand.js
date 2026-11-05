import kit from "./premium.module.css";
import inner from "./inner.module.css";

// Closing action band on the navy field. `children` are the actions (links styled with the kit button classes).
export default function CtaBand({ id, eyebrow, title, text, children }) {
  return (
    <section className={`${kit.sec} ${kit.band}`} aria-labelledby={id}>
      <div className={`${kit.wrap} ${inner.ctaBand}`}>
        <div>
          {eyebrow && <span className={inner.eyebrow}>{eyebrow}</span>}
          <h2 id={id}>{title}</h2>
          {text && <p>{text}</p>}
        </div>
        <div className={inner.actions}>{children}</div>
      </div>
    </section>
  );
}
