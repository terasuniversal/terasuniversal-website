"use client";

import Script from "next/script";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { isUntrackedPath, sanitizeAnalyticsUrl, sanitizeReferrer } from "../lib/analytics-privacy";
import { CONSENT_CHANGE_EVENT, CONSENT_GRANTED, isValidMeasurementId, readConsent } from "../lib/analytics-consent";
import AnalyticsConsentBanner from "./AnalyticsConsentBanner";

const measurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
// W5-a: a missing or malformed measurement ID keeps analytics (and the consent banner) off entirely.
const analyticsEnabled = process.env.NODE_ENV === "production" && isValidMeasurementId(measurementId);

// S5B-1B Round 2 (analytics URL privacy, S5B-0 PAY-04):
// - Admin, payment, registration, certificate-verification and feedback routes are never tracked: no script is
//   loaded there, and if a visitor navigates into one client-side after analytics loaded, GA4 is switched off with
//   the documented window["ga-disable-<ID>"] flag for as long as they stay there.
// - Everywhere else GA4 only receives a sanitised page_location / page_referrer (origin + path + utm_* only). They
//   are set with gtag("config") before any event, so they also apply to hits GA4 would send automatically, and
//   automatic page views stay off (send_page_view: false).
// - The gtag queue is created here rather than in an inline script, so the "js" and "config" commands are always
//   queued in order before the first event, whichever runs first.
// W5-a (owner-approved D-07): explicit opt-in. gtag.js is not loaded, and nothing is sent, until the visitor chooses
// "Accept analytics" (lib/analytics-consent.js); window.__TERAS_ANALYTICS_CONSENT__ is true only then. Google Signals
// and ad personalisation are off, and Google Tag Manager support was removed (it could load tags outside these rules).
function canTrack(pathname) {
  return analyticsEnabled && typeof window !== "undefined" && window.__TERAS_ANALYTICS_CONSENT__ === true && !isUntrackedPath(pathname);
}

function ensureGtag() {
  window.dataLayer = window.dataLayer || [];
  if (typeof window.gtag !== "function") {
    window.gtag = function gtag() {
      // gtag.js reads the arguments object itself, so it is pushed as is.
      window.dataLayer.push(arguments); // eslint-disable-line prefer-rest-params
    };
  }
  if (!window.__terasGtagStarted) {
    // Analytics storage only: advertising storage and signals stay denied (Consent Mode v2 defaults).
    window.gtag("consent", "default", { analytics_storage: "granted", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" });
    window.gtag("js", new Date());
    window.__terasGtagStarted = true;
  }
}

export default function Analytics() {
  const pathname = usePathname();
  const untracked = isUntrackedPath(pathname);
  // null until the stored choice has been read on the client (the server never renders the banner or the script).
  const [consent, setConsent] = useState(null);
  const [consentRead, setConsentRead] = useState(false);

  useEffect(() => {
    if (!analyticsEnabled) return undefined;
    const sync = () => {
      let storage = null;
      try { storage = window.localStorage; } catch { storage = null; }
      const value = window.__TERAS_ANALYTICS_CHOICE__ || readConsent(storage);
      window.__TERAS_ANALYTICS_CONSENT__ = value === CONSENT_GRANTED;
      setConsent(value);
      setConsentRead(true);
    };
    sync();
    window.addEventListener(CONSENT_CHANGE_EVENT, sync);
    return () => window.removeEventListener(CONSENT_CHANGE_EVENT, sync);
  }, []);

  useEffect(() => {
    if (!analyticsEnabled) return;
    window[`ga-disable-${measurementId}`] = isUntrackedPath(pathname) || consent !== CONSENT_GRANTED;
    // The rendered consent state must agree with the global flag, so one page view is sent once the choice is read.
    if (consent !== CONSENT_GRANTED || !canTrack(pathname)) return;
    ensureGtag();
    const pageLocation = sanitizeAnalyticsUrl(window.location.href);
    const pageReferrer = sanitizeReferrer(document.referrer, window.location.origin);
    window.gtag("config", measurementId, { send_page_view: false, page_location: pageLocation, page_referrer: pageReferrer, allow_google_signals: false, allow_ad_personalization_signals: false });
    window.gtag("event", "page_view", { page_location: pageLocation, page_path: new URL(pageLocation).pathname, page_title: document.title });
  }, [pathname, consent]);

  useEffect(() => {
    const handleClick = (event) => {
      if (!canTrack(window.location.pathname) || typeof window.gtag !== "function") return;
      const target = event.target.closest?.("a, button");
      if (!target || !target.matches(".btn, .nav-proposal, .nav-cta, .sticky-cta a, .training-card-link")) return;
      const label = target.textContent.replace(/\s+/g, " ").trim().slice(0, 100);
      window.gtag("event", "cta_click", { cta_label: label, cta_destination: target.href ? sanitizeAnalyticsUrl(target.href) : "button" });
    };
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  useEffect(() => {
    if (pathname === "/request-proposal/success" && canTrack(pathname)) window.gtag?.("event", "proposal_conversion", { page_path: pathname });
  }, [pathname, consent]);

  // Nothing is loaded on untracked routes, or without a valid measurement ID: a full page load there never fetches gtag.js.
  if (untracked || !analyticsEnabled) return null;

  return (
    <>
      {consentRead && consent === null && <AnalyticsConsentBanner />}
      {consent === CONSENT_GRANTED && <Script src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`} strategy="afterInteractive" />}
    </>
  );
}
