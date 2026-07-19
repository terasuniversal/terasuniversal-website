"use client";

import Script from "next/script";
import { useEffect } from "react";
import { usePathname } from "next/navigation";

const measurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
const tagManagerId = process.env.NEXT_PUBLIC_GTM_ID;
const analyticsEnabled = process.env.NODE_ENV === "production" && Boolean(measurementId);
const tagManagerEnabled = process.env.NODE_ENV === "production" && Boolean(tagManagerId);

function canTrack() {
  return analyticsEnabled && typeof window !== "undefined" && window.__TERAS_ANALYTICS_CONSENT__ !== false;
}

export default function Analytics() {
  const pathname = usePathname();

  useEffect(() => {
    if (!canTrack() || typeof window.gtag !== "function") return;
    window.gtag("event", "page_view", {
      page_path: `${pathname}${window.location.search}`,
      page_title: document.title,
      page_location: window.location.href,
    });
  }, [pathname]);

  useEffect(() => {
    if (!canTrack()) return undefined;
    const handleClick = (event) => {
      const target = event.target.closest?.("a, button");
      if (!target || !target.matches(".btn, .nav-proposal, .nav-cta, .sticky-cta a, .training-card-link")) return;
      const label = target.textContent.replace(/\s+/g, " ").trim().slice(0, 100);
      window.gtag?.("event", "cta_click", { cta_label: label, cta_destination: target.href || "button" });
    };
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  useEffect(() => {
    if (pathname === "/request-proposal/success" && canTrack()) window.gtag?.("event", "proposal_conversion", { page_path: pathname });
  }, [pathname]);

  if (!analyticsEnabled && !tagManagerEnabled) return null;

  return (
    <>
      {tagManagerEnabled && <><Script id="teras-google-tag-manager-init" strategy="afterInteractive">{`window.dataLayer = window.dataLayer || []; window.dataLayer.push({'gtm.start': new Date().getTime(), event: 'gtm.js'});`}</Script><Script src={`https://www.googletagmanager.com/gtm.js?id=${tagManagerId}`} strategy="afterInteractive" /></>}
      {analyticsEnabled && <><Script src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`} strategy="afterInteractive" /><Script id="teras-google-analytics" strategy="afterInteractive">
        {`window.dataLayer = window.dataLayer || [];
function gtag(){window.dataLayer.push(arguments);}
window.gtag = gtag;
gtag('js', new Date());
gtag('config', '${measurementId}', { send_page_view: false });`}
      </Script></>}
    </>
  );
}
