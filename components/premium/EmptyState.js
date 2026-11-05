import inner from "./inner.module.css";

// Accessible empty or unavailable state: announced politely, always with a way forward.
export default function EmptyState({ title, text, children }) {
  return (
    <div className={inner.empty} role="status">
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {children && <div className={inner.actions}>{children}</div>}
    </div>
  );
}
