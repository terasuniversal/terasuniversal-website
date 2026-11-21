"use client";

import { useEffect, useRef, useState } from "react";
import { enquiryHref } from "../public/PrimaryCtaGroup";
import { courseContent } from "../../content/en/course";
import styles from "./course.module.css";

// FT-1A-2 (owner-approved): three separate, truthful routes from a course page. Individuals use the existing /contact
// form, companies the existing corporate /request-proposal form, and registration follows the page's own Public-First
// decision (hasRegistration / registerHref come from app/training/[slug]/page.js, which already honours the F-1 gate).
// No form, fetch, API or database call lives here. Layout and button classes come from the page, which owns the Premium
// kit. The phone quick-enquiry bar hides itself while this section or the footer is on screen, so it never covers them.
export default function CourseEnquiryPaths({ course, hasRegistration, registerHref, sectionClass, wrapClass, primaryButton, lineButton }) {
  const text = courseContent.paths;
  const section = useRef(null);
  const bar = useRef(null);
  const [barHidden, setBarHidden] = useState(false);

  // Keyboard focus is never left under the phone bar (WCAG 2.4.11): when a focused control lands behind it, the page
  // scrolls just enough to reveal it. Does nothing on wide screens, where the bar is not displayed.
  useEffect(() => {
    const reveal = (event) => {
      const node = bar.current;
      if (!node || node.contains(event.target) || getComputedStyle(node).display === "none") return;
      const barTop = node.getBoundingClientRect().top;
      const rect = event.target.getBoundingClientRect?.();
      if (rect && rect.bottom > barTop - 8) window.scrollBy(0, rect.bottom - barTop + 16);
    };
    document.addEventListener("focusin", reveal);
    return () => document.removeEventListener("focusin", reveal);
  }, []);

  useEffect(() => {
    const targets = [section.current, document.querySelector("footer")].filter(Boolean);
    if (targets.length === 0 || typeof IntersectionObserver === "undefined") return undefined;
    const visible = new Set();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target);
        else visible.delete(entry.target);
      }
      setBarHidden(visible.size > 0);
    });
    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, []);

  const registration = hasRegistration ? text.registration.open : text.registration.closed;
  return (
    <>
      <section ref={section} id="enquire" className={sectionClass} aria-labelledby="course-enquire-title">
        <div className={wrapClass}>
          <p className={styles.eyebrow}>{text.eyebrow}</p>
          <h2 id="course-enquire-title">{text.title}</h2>
          <div className={styles.pathsWrap}><ul className={styles.paths}>
            <li className={styles.path}>
              <h3>{text.individual.title}</h3>
              <p className={styles.pathText}>{text.individual.text}</p>
              <p className={styles.pathNote}>{text.individual.note}</p>
              <a className={primaryButton} href={text.individual.href}>{text.individual.cta}</a>
            </li>
            <li className={styles.path}>
              <h3>{text.company.title}</h3>
              <p className={styles.pathText}>{text.company.text}</p>
              <p className={styles.pathNote}>{text.company.note}</p>
              <a className={lineButton} href={enquiryHref({ course: course.slug, source: "course-enquire" })}>{text.company.cta}</a>
            </li>
            <li className={`${styles.path} ${hasRegistration ? "" : styles.pathOff}`}>
              <h3>{text.registration.title}</h3>
              <p className={styles.pathText}>{registration.text}</p>
              <a className={lineButton} href={registerHref}>{registration.cta}</a>
            </li>
          </ul></div>
        </div>
        {/* Inside the section so the bar inherits the Premium kit tokens (the --px-* colours are set on the .px element). */}
        <nav ref={bar} className={`${styles.sticky} ${barHidden ? styles.stickyHidden : ""}`} aria-label={text.sticky.label}>
          <a className={primaryButton} href="#enquire">{text.sticky.enquire}</a>
          <a className={lineButton} href={courseContent.actions.whatsappHref(course.title)} target="_blank" rel="noreferrer">{text.sticky.whatsapp}</a>
        </nav>
      </section>
    </>
  );
}
