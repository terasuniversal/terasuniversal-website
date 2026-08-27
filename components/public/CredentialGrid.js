import styles from "./public-phase-two.module.css";

export default function CredentialGrid({ credentials }) {
  if (!credentials?.length) return null;

  return (
    <div className={styles.credentialGrid}>
      {credentials.map((credential) => (
        <article className={styles.credentialCard} key={credential.org}>
          <span>{credential.org}</span>
          <h3>{credential.label}</h3>
          <p>{credential.text}</p>
        </article>
      ))}
    </div>
  );
}
