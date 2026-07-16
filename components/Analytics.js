"use client";

import Script from "next/script";
import { useEffect } from "react";
import { usePathname } from "next/navigation";

const measurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
const analyticsEnabled = process.env.NODE_ENV === "production" && Boolean(measurementId);

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

  if (!analyticsEnabled) return null;

  return (
    <>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`} strategy="afterInteractive" />
      <Script id="teras-google-analytics" strategy="afterInteractive">
        {`window.dataLayer = window.dataLayer || [];
function gtag(){window.dataLayer.push(arguments);}
window.gtag = gtag;
gtag('js', new Date());
gtag('config', '${measurementId}', { send_page_view: false });`}
      </Script>
    </>
  );
}