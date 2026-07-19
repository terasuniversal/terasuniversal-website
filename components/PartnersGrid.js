import Image from "next/image";
import { partners } from "../data/partners";

const groups = [
  ["strategic", "Strategic Partners"],
  ["government", "Government"],
  ["industry", "Industry"],
  ["education", "Education"],
];

export default function PartnersGrid() {
  const hasAny = groups.some(([key]) => partners[key]?.length);
  if (!hasAny) return null;
  return (
    <div className="partners-groups">
      {groups.map(([key, label]) => (
        partners[key]?.length ? (
          <div className="partners-group" key={key}>
            <h3>{label}</h3>
            <div className="partners-logo-row">
              {partners[key].map((partner) => (
                <a className="partners-logo" key={partner.name} href={partner.url || undefined} target={partner.url ? "_blank" : undefined} rel={partner.url ? "noreferrer" : undefined} aria-label={partner.name}>
                  {partner.logo ? <Image src={partner.logo} alt={partner.name} width={160} height={80} sizes="160px" /> : <span>{partner.name}</span>}
                </a>
              ))}
            </div>
          </div>
        ) : null
      ))}
    </div>
  );
}
