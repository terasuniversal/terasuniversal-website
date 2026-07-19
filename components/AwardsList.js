import { awards } from "../data/awards";

export default function AwardsList() {
  if (!awards.length) return null;
  return (
    <div className="awards-grid">
      {awards.map((award) => (
        <article className="award-card" key={`${award.title}-${award.year}`}>
          <span className="award-year">{award.year}</span>
          <h3>{award.title}</h3>
          <span className="award-issuer">{award.issuer}</span>
          {award.description ? <p>{award.description}</p> : null}
        </article>
      ))}
    </div>
  );
}
