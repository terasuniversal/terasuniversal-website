import styles from "./public-phase-two.module.css";

const phone = "60195193834";

export default function CorporateTrainingCta({ industry, source = "corporate-training", title = "Build the right capability for your workforce.", text = "Tell us about your workforce, operating environment and preferred delivery arrangement." }) {
  const params = new URLSearchParams({ source });
  if (industry) params.set("industry", industry);
  const proposalHref = `/request-proposal?${params.toString()}`;
  const message = industry
    ? `Hi TERAS, saya ingin bertanya tentang latihan untuk industri ${industry.replace(/-/g, " ")}.`
    : "Hi TERAS, saya ingin bertanya tentang latihan korporat.";

  return (
    <section className={styles.corporateCta}>
      <div>
        <span className="eyebrow">Corporate &amp; Custom Solutions</span>
        <h2>{title}</h2>
        <p>{text}</p>
      </div>
      <div className={styles.ctaActions}>
        <a className={styles.primaryAction} href={proposalHref}>Request Corporate Training</a>
        <a className={styles.secondaryAction} href={`https://wa.me/${phone}?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer">Talk to TERAS</a>
      </div>
    </section>
  );
}
