"use client";

import Script from "next/script";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { isUntrackedPath, sanitizeAnalyticsUrl, sanitizeReferrer } from "../lib/analytics-privacy";

const measurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
const tagManagerId = process.env.NEXT_PUBLIC_GTM_ID;
const analyticsEnabled = process.env.NODE_ENV === "production" && Boolean(measurementId);
const tagManagerEnabled = process.env.NODE_ENV === "production" && Boolean(tagManagerId);

// S5B-1B Round 2 (analytics URL privacy, S5B-0 PAY-04):
// - Admin, payment, registration, certificate-verification and feedback routes are never tracked: no script is
//   loaded there, and if a visitor navigates into one client-side after analytics loaded, GA4 is switched off with
//   the documented window["ga-disable-<ID>"] flag for as long as they stay there.
// - Everywhere else GA4 only receives a sanitised page_location / page_referrer (origin + path + utm_* only). They
//   are set with gtag("config") before any event, so they also apply to hits GA4 would send automatically, and
//   automatic page views stay off (send_page_view: false).
// - The gtag queue is created here rather than in an inline script, so the "js" and "config" commands are always
//   queued in order before the first event, whichever runs first.
// - Owner consent policy (D-07) is still open; the existing opt-out flag window.__TERAS_ANALYTICS_CONSENT__ = false
//   keeps working unchanged.
function canTrack(pathname) {
  return analyticsEnabled && typeof window !== "undefined" && window.__TERAS_ANALYTICS_CONSENT__ !== false && !isUntrackedPath(pathname);
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
    window.gtag("js", new Date());
    window.__terasGtagStarted = true;
  }
}

export default function Analytics() {
  const pathname = usePathname();
  const untracked = isUntrackedPath(pathname);
  // A-1: the tag scripts are rendered only after mount, so a refused consent is known before anything is requested
  // (server-rendered afterInteractive scripts would otherwise be fetched regardless of the opt-out flag).
  const [consentChecked, setConsentChecked] = useState(false);
  const [consentRefused, setConsentRefused] = useState(false);
  useEffect(() => { setConsentRefused(window.__TERAS_ANALYTICS_CONSENT__ === false); setConsentChecked(true); }, [pathname]);

  useEffect(() => {
    if (!analyticsEnabled) return;
    window[`ga-disable-${measurementId}`] = isUntrackedPath(pathname);
    // A-1: refused or revoked consent switches GA4 off for the rest of the visit (automatic hits included).
    if (window.__TERAS_ANALYTICS_CONSENT__ === false) window[`ga-disable-${measurementId}`] = true;
    if (!canTrack(pathname)) return;
    ensureGtag();
    const pageLocation = sanitizeAnalyticsUrl(window.location.href);
    const pageReferrer = sanitizeReferrer(document.referrer, window.location.origin);
    window.gtag("config", measurementId, { send_page_view: false, page_location: pageLocation, page_referrer: pageReferrer });
    window.gtag("event", "page_view", { page_location: pageLocation, page_path: new URL(pageLocation).pathname, page_title: document.title });
  }, [pathname]);

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
  }, [pathname]);

  // A-1: with consent refused (the existing opt-out flag) neither gtag.js nor gtm.js is requested at all.
  if (!consentChecked || consentRefused) return null;
  // Nothing is loaded on untracked routes: a full page load there never fetches gtag.js or gtm.js.
  if (untracked || (!analyticsEnabled && !tagManagerEnabled)) return null;

  return (
    <>
      {tagManagerEnabled && <><Script id="teras-google-tag-manager-init" strategy="afterInteractive">{`window.dataLayer = window.dataLayer || []; window.dataLayer.push({'gtm.start': new Date().getTime(), event: 'gtm.js'});`}</Script><Script src={`https://www.googletagmanager.com/gtm.js?id=${tagManagerId}`} strategy="afterInteractive" /></>}
      {analyticsEnabled && <Script src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`} strategy="afterInteractive" />}
    </>
  );
}
