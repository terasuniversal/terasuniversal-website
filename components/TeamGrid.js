import Image from "next/image";
import { teamMembers } from "../data/team";

export default function TeamGrid() {
  if (!teamMembers.length) return null;
  return (
    <div className="team-grid">
      {teamMembers.map((member) => (
        <article className="team-card" key={member.name}>
          {member.photo ? (
            <div className="team-card-photo"><Image src={member.photo} alt={member.name} width={320} height={320} sizes="(max-width: 590px) 50vw, 220px" /></div>
          ) : (
            <div className="team-card-photo team-card-photo-placeholder" aria-hidden="true">{member.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</div>
          )}
          <h3>{member.name}</h3>
          <span className="team-card-position">{member.position}</span>
          <p>{member.bio}</p>
          {member.expertise?.length ? <div className="team-card-tags">{member.expertise.map((tag) => <span key={tag}>{tag}</span>)}</div> : null}
          {member.linkedin ? <a className="team-card-linkedin" href={member.linkedin} target="_blank" rel="noreferrer">LinkedIn <span aria-hidden="true">&rarr;</span></a> : null}
        </article>
      ))}
    </div>
  );
}
