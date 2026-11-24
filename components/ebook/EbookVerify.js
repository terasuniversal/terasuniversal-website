"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./ebook.module.css";
import { parseVerifyLink } from "../../lib/ebook-verify-link.js";

// W9-G3 email verification and download page (W9-EBOOK-RPC-CONTRACT v1.0 §4). Opening the link (GET) only shows this
// page: nothing is consumed until the visitor presses "Confirm my email" (POST /api/ebook/verify), so email security
// scanners that open links cannot use the token. The token is removed from the address bar and history straight away.
// After verification the single-use download token stays in memory and is sent in a POST body; it never appears in a
// URL. The server answers with a 60-second signed URL, which the page opens with window.location (a form POST that
// redirects to Storage would be blocked by the site CSP form-action). The signed URL is not stored or logged. One generic message covers invalid, expired, replaced and already-used links (no enumeration).
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export default function EbookVerify() {
  const [token, setToken] = useState(null);
  const [state, setState] = useState("loading"); // loading | confirm | verifying | verified | link_unusable | download_unusable | download_unavailable | unavailable
  const [downloadToken, setDownloadToken] = useState(null);
  const statusRef = useRef(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    // W9-G3.1 (erratum v1.0.2): the token arrives in the fragment (#t=…), which the browser never sends to a server.
    // Read it once, then remove fragment and query from the visible URL and the history entry before anything else.
    // The token lives only in React memory (never in storage, cookies or a URL). A legacy ?t= link is refused.
    // A second link opened in a tab already on this page is a same-document fragment navigation (no reload), so the
    // link is read again on hashchange; otherwise the new token would stay in the address bar and history.
    const readLink = () => {
      const link = parseVerifyLink({ hash: window.location.hash, search: window.location.search });
      window.history.replaceState(null, "", window.location.pathname);
      setDownloadToken(null);
      if (link.state) { setToken(null); setState(link.state); }
      else if (link.token) { setToken(link.token); setState("confirm"); } else { setToken(null); setState("link_unusable"); }
    };
    readLink();
    window.addEventListener("hashchange", readLink);
    return () => window.removeEventListener("hashchange", readLink);
  }, []);
  useEffect(() => { if (state !== "loading" && state !== "verifying") statusRef.current?.focus(); }, [state]);

  async function confirm() {
    setState("verifying");
    try {
      const response = await fetch("/api/ebook/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ t: token }) });
      const data = await response.json().catch(() => ({}));
      setToken(null);
      if (response.ok && data.status === "verified" && TOKEN.test(String(data.downloadToken || ""))) { setDownloadToken(data.downloadToken); setState("verified"); return; }
      setState(response.ok ? "link_unusable" : "unavailable");
    } catch {
      setState("unavailable");
    }
  }

  async function download() {
    setDownloading(true);
    try {
      const response = await fetch("/api/ebook/download", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ t: downloadToken }) });
      const data = await response.json().catch(() => ({}));
      setDownloadToken(null);
      if (response.ok && data.status === "ready" && typeof data.url === "string" && /^https?:\/\//.test(data.url)) {
        setState("downloaded");
        window.location.assign(data.url);
        return;
      }
      setState(data.status === "download_unavailable" || !response.ok ? "download_unavailable" : "download_unusable");
    } catch {
      setState("download_unavailable");
    } finally {
      setDownloading(false);
    }
  }

  const box = (title, children) => (
    <div className={styles.result} role="status" aria-live="polite" tabIndex={-1} ref={statusRef}>
      <h2 className={styles.verifyTitle}>{title}</h2>
      {children}
    </div>
  );

  if (state === "loading") return box("Checking your link…", <p>One moment.</p>);
  if (state === "confirm" || state === "verifying") {
    return box("Confirm your email address", (
      <>
        <p>Press the button to confirm your email and get your free eBook, <em lang="ms">Dari Zero ke Dunia Industri</em>.</p>
        <button type="button" className={styles.submit} onClick={confirm} disabled={state === "verifying"}>{state === "verifying" ? "Confirming…" : "Confirm my email"}</button>
      </>
    ));
  }
  if (state === "verified") {
    return box("Your email is confirmed", (
      <>
        <p>Your eBook is ready. The download button works once; the file opens straight away.</p>
        <button type="button" className={styles.submit} onClick={download} disabled={downloading || !downloadToken}>{downloading ? "Preparing your download…" : "Download the eBook (PDF)"}</button>
        <p className={styles.hint}>If the download does not start within 15 minutes, request a new link from the eBook page.</p>
      </>
    ));
  }
  if (state === "downloaded") {
    return box("Your download has started", (
      <>
        <p>If the PDF did not open, check your downloads folder. The download link was single-use; request a new link from the eBook page if you need the file again.</p>
        <a className={styles.reset} href="/ebook#ebook-request">Back to the eBook page</a>
      </>
    ));
  }
  const message = {
    link_unusable: ["This link cannot be used", "The link is invalid, has expired, was replaced by a newer link, or has already been used."],
    download_unusable: ["This download link cannot be used", "The download has expired or has already been used."],
    download_unavailable: ["The download is temporarily unavailable", "Please try again in a few minutes."],
    unavailable: ["The service is temporarily unavailable", "Please try again in a few minutes."],
  }[state] || ["This link cannot be used", "Please request a new link."];
  return box(message[0], (
    <>
      <p>{message[1]}</p>
      <a className={styles.reset} href="/ebook#ebook-request">Request a new link</a>
    </>
  ));
}
