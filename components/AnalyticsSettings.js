"use client";

import { useEffect, useState } from "react";
import { CONSENT_CHANGE_EVENT, CONSENT_DENIED, CONSENT_GRANTED, analyticsConfigured, applyConsentChoice, readConsent } from "../lib/analytics-consent";
import styles from "./analytics-consent.module.css";

// W5-a (owner-approved D-07): "Analytics settings" on /privacy and /privacy/ms, where a visitor can give, change or
// withdraw consent at any time. Rendered only when GA4 is configured, so it never appears while analytics is unused.
const configured = analyticsConfigured(process.env.NODE_ENV, process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID);

const TEXT = {
  en: {
    title: "Analytics settings",
    granted: "You have accepted Google Analytics on this website.",
    denied: "You have rejected Google Analytics. No analytics is used on this website for you.",
    none: "You have not made a choice yet. Google Analytics is off until you accept it.",
    accept: "Accept analytics",
    reject: "Reject or withdraw consent",
  },
  ms: {
    title: "Tetapan analitik",
    granted: "Anda telah menerima Google Analytics di laman web ini.",
    denied: "Anda telah menolak Google Analytics. Tiada analitik digunakan di laman web ini untuk anda.",
    none: "Anda belum membuat pilihan. Google Analytics dimatikan sehingga anda menerimanya.",
    accept: "Terima analitik",
    reject: "Tolak atau tarik balik persetujuan",
  },
};

export default function AnalyticsSettings({ lang = "en" }) {
  const text = TEXT[lang === "ms" ? "ms" : "en"];
  const [choice, setChoice] = useState(undefined);

  useEffect(() => {
    if (!configured) return undefined;
    const sync = () => {
      let storage = null;
      try { storage = window.localStorage; } catch { storage = null; }
      setChoice(window.__TERAS_ANALYTICS_CHOICE__ || readConsent(storage));
    };
    sync();
    window.addEventListener(CONSENT_CHANGE_EVENT, sync);
    return () => window.removeEventListener(CONSENT_CHANGE_EVENT, sync);
  }, []);

  if (!configured || choice === undefined) return null;
  return (
    <section id="analytics-settings" className={styles.settings} aria-labelledby="teras-analytics-settings-title">
      <h2 id="teras-analytics-settings-title" className={styles.title}>{text.title}</h2>
      <p role="status">{choice === CONSENT_GRANTED ? text.granted : choice === CONSENT_DENIED ? text.denied : text.none}</p>
      <div className={styles.actions}>
        <button type="button" className={styles.accept} onClick={() => applyConsentChoice(window, CONSENT_GRANTED)} disabled={choice === CONSENT_GRANTED}>{text.accept}</button>
        <button type="button" className={styles.reject} onClick={() => applyConsentChoice(window, CONSENT_DENIED)} disabled={choice === CONSENT_DENIED}>{text.reject}</button>
      </div>
    </section>
  );
}
