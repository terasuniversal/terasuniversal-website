"use client";

import { useState } from "react";
import Image from "next/image";
import styles from "./home.module.css";

// The photograph beside the list follows hover or keyboard focus. It is decorative:
// every programme also has its own inline photograph on small screens, and the first
// photograph is the no-script default.
export default function ProgrammeList({ items }) {
  const [active, setActive] = useState(0);
  return (
    <div className={styles.progGrid}>
      <ul className={styles.plist}>
        {items.map((item, index) => (
          <li key={item.href} data-reveal onMouseEnter={() => setActive(index)}>
            <h3><a className={styles.progLink} href={item.href} onFocus={() => setActive(index)}>{item.title}</a></h3>
            <p className={styles.progSummary}>{item.summary}<strong className={styles.progFacts}>{item.facts}</strong></p>
            <div className={styles.progInline}>
              <Image src={item.image} alt={item.alt} fill loading="lazy" sizes="100vw" />
            </div>
          </li>
        ))}
      </ul>
      <div className={styles.stage} aria-hidden="true">
        {items.map((item, index) => (
          <Image key={item.href} className={index === active ? styles.stageOn : styles.stageImg} src={item.image} alt="" fill loading={index === 0 ? "eager" : "lazy"} sizes="40vw" />
        ))}
      </div>
    </div>
  );
}
