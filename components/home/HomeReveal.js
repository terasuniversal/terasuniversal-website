"use client";

import { useEffect } from "react";
import styles from "./home.module.css";

// Staggered entrance for elements marked data-reveal. Content stays visible without script,
// and nothing moves when the visitor prefers reduced motion.
export default function HomeReveal() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return undefined;
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add(styles.rvIn);
          observer.unobserve(entry.target);
        }
      });
    }, { rootMargin: "0px 0px -8% 0px" });
    document.querySelectorAll("[data-reveal]").forEach((element) => {
      const index = element.parentElement ? Array.prototype.indexOf.call(element.parentElement.children, element) : 0;
      element.style.transitionDelay = `${Math.min(index, 5) * 75}ms`;
      element.classList.add(styles.rv);
      observer.observe(element);
    });
    return () => observer.disconnect();
  }, []);
  return null;
}
