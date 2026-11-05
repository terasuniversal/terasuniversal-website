"use client";

import { useState } from "react";
import Image from "next/image";
import styles from "./home.module.css";

// The photograph beside the list follows hover or keyboard focus. It is decorative:
// every programme also has its own inline photograph on small screens, and the first
// photograph is the no-script default.
// Decorative Navy/Gold panel used where no approved photograph exists for a programme. The heading beside it
// already names the programme, so the panel is hidden from assistive technology.
function ProgrammePanel({ number, title }) {
  return (
    <div className={styles.panel} aria-hidden="true">
      <span className={styles.panelNo}>{number}</span>
      <span className={styles.panelTitle}>{title}</span>
    </div>
  );
}

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
              {item.image
                ? <Image src={item.image} alt={item.alt} fill loading="lazy" sizes="100vw" />
                : <ProgrammePanel number={item.panel} title={item.title} />}
            </div>
          </li>
        ))}
      </ul>
      <div className={styles.stage} aria-hidden="true">
        {items.map((item, index) => item.image ? (
          <Image key={item.href} className={index === active ? styles.stageOn : styles.stageImg} src={item.image} alt="" fill loading={index === 0 ? "eager" : "lazy"} sizes="40vw" />
        ) : (
          <div key={item.href} className={`${styles.panelWrap} ${index === active ? styles.stageOn : styles.stageImg}`}>
            <ProgrammePanel number={item.panel} title={item.title} />
          </div>
        ))}
      </div>
    </div>
  );
}
