import styles from "./public-phase-two.module.css";

export default function TrustStrip({ facts, className = "" }) {
  if (!facts?.length) return null;

  return (
    <section className={`${styles.trustStrip} ${className}`.trim()} aria-label="TERAS UNIVERSAL credentials">
      {facts.map((fact) => <span key={fact}>{fact}</span>)}
    </section>
  );
}
