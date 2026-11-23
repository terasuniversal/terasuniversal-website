"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CONSENT_DENIED, CONSENT_GRANTED, applyConsentChoice } from "../lib/analytics-consent";
import PrivacyNoticeLink from "./legal/PrivacyNoticeLink";
import styles from "./analytics-consent.module.css";

// W5-a (owner-approved D-07): the explicit opt-in banner, in English and Bahasa Melayu. It is rendered only by
// components/Analytics.js, and only when GA4 is configured, the visitor has made no choice yet and the route is tracked.
// It does not block the page: the visitor can keep reading, and analytics stays off until "Accept analytics".
// It is placed right after the skip link, so keyboard users reach the choice first without focus being moved for them.
export default function AnalyticsConsentBanner() {
  const [host, setHost] = useState(null);

  useEffect(() => {
    const element = document.createElement("div");
    const skipLink = document.querySelector("a.skip-link");
    if (skipLink?.parentNode) skipLink.after(element);
    else document.body.prepend(element);
    setHost(element);
    return () => element.remove();
  }, []);

  if (!host) return null;
  return createPortal(
    <section className={styles.banner} role="region" aria-labelledby="teras-analytics-consent-title">
      <div className={styles.text}>
        <h2 id="teras-analytics-consent-title" className={styles.title}>Analytics · Analitik</h2>
        <p lang="en">May we use Google Analytics to see how this website is used? It stays off unless you accept, and never runs on payment, registration, verification or feedback pages.</p>
        <p lang="ms">Bolehkah kami menggunakan Google Analytics untuk melihat cara laman web ini digunakan? Ia kekal dimatikan kecuali anda bersetuju.</p>
        {/* The one shared, publication-gated link to the notice (s5b1b-round2: no other component links to /privacy). */}
        <p className={styles.links} lang="en"><PrivacyNoticeLink /></p>
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.accept} onClick={() => applyConsentChoice(window, CONSENT_GRANTED)}>Accept analytics · Terima analitik</button>
        <button type="button" className={styles.reject} onClick={() => applyConsentChoice(window, CONSENT_DENIED)}>Reject · Tolak</button>
      </div>
    </section>,
    host,
  );
}
