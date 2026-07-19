"use client";

import { useEffect } from "react";
import SiteHeader from "../components/SiteHeader";
import SiteFooter from "../components/SiteFooter";

export default function ErrorBoundary({ error, reset }) {
  useEffect(() => {
    console.error("Unhandled application error", error);
  }, [error]);

  return (
    <main className="utility-page not-found-page">
      <SiteHeader />
      <div className="container utility-container not-found-content">
        <span className="eyebrow">Something Went Wrong</span>
        <h1>We hit an unexpected error.</h1>
        <p className="utility-lead">Our team has been notified. Please try again, or return to the homepage and continue browsing.</p>
        <div className="hero-actions">
          <button type="button" className="btn btn-primary" onClick={() => reset()}>Try Again</button>
          <a className="btn btn-outline" href="/">Return Home</a>
          <a className="btn btn-outline" href="/contact">Contact Us</a>
        </div>
      </div>
      <SiteFooter />
    </main>
  );
}
