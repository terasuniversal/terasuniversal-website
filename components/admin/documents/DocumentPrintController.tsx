"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  A4_HEIGHT_PX,
  A4_TOLERANCE_PX,
  READINESS_CAP_MS,
  canManuallyPrint,
  evaluateReadiness,
  shouldAutoPrint,
  statusMessage,
  type Readiness,
  type ReadinessSnapshot,
} from "../../../lib/documents/print-readiness";

/** Window-level marker so a remount (hydration, StrictMode, re-render) never opens a second automatic dialog. */
const AUTO_PRINT_MARKER = "__terasDocumentAutoPrinted";
type MarkedWindow = Window & { [AUTO_PRINT_MARKER]?: string };

function paperBoxes(papers: HTMLElement[]): string {
  return papers.map((p) => { const r = p.getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}@${Math.round(r.left)}`; }).join("|");
}

function overflowingPaperCount(papers: HTMLElement[], printGeometryAttribute: string | undefined): number {
  const measure = () => papers.filter((p) => Math.max(p.getBoundingClientRect().height, p.scrollHeight) > A4_HEIGHT_PX + A4_TOLERANCE_PX).length;
  if (!printGeometryAttribute) return measure();
  // Apply the page's print rules (scoped under html[attribute]) for one synchronous layout, measure, and restore
  // before the browser can paint, so the preview never flickers.
  const root = document.documentElement;
  root.setAttribute(printGeometryAttribute, "");
  try { return measure(); } finally { root.removeAttribute(printGeometryAttribute); }
}

function snapshot(selector: string, previousBoxes: string | null, verifyA4Fit: boolean, printGeometryAttribute: string | undefined): { snap: ReadinessSnapshot; boxes: string } {
  const papers = Array.from(document.querySelectorAll<HTMLElement>(selector));
  const boxes = paperBoxes(papers);
  const papersVisible = papers.length > 0 && papers.every((p) => { const r = p.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !p.closest("[hidden]"); });
  let obstructed = Array.from(document.querySelectorAll<HTMLElement>(".loading-screen")).some((el) => {
    const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity) > 0;
  });
  if (!obstructed && papers[0]) {
    // The document itself must be on top where it is visible (nothing painted over its first lines).
    const r = papers[0].getBoundingClientRect();
    const y = Math.max(r.top + 40, 1);
    if (y < window.innerHeight - 1 && r.bottom > 0) {
      const x = Math.min(Math.max(r.left + Math.min(r.width / 2, 200), 1), window.innerWidth - 1);
      const top = document.elementFromPoint(x, y);
      // This controller's own sticky toolbar is screen-only and never printed, so it does not count.
      obstructed = Boolean(top && !papers[0].contains(top) && !top.closest("[data-print-hide]"));
    }
  }
  const images = papers.flatMap((p) => Array.from(p.querySelectorAll("img")));
  const imagesPending = images.filter((img) => !img.complete).length;
  const imagesFailed = images.filter((img) => img.complete && img.naturalWidth === 0).length;
  const fontsLoaded = typeof document.fonts === "undefined" || document.fonts.status === "loaded";
  // A paper with a fixed A4 height can still overflow (scrollHeight); one with min-height grows instead. Measured
  // only once the other checks pass, in print geometry when the page provides it (quotation), else on screen
  // (invoice, whose screen paper is calibrated to fit A4).
  const settled = papersVisible && !obstructed && fontsLoaded && imagesPending === 0 && imagesFailed === 0;
  const overflowingPapers = verifyA4Fit && settled ? overflowingPaperCount(papers, printGeometryAttribute) : 0;
  return {
    boxes,
    snap: { paperCount: papers.length, papersVisible, obstructed, fontsLoaded, imagesPending, imagesFailed, overflowingPapers, layoutStable: previousBoxes !== null && previousBoxes === boxes },
  };
}

/**
 * Prints a server-rendered document (invoice, quotation) once it is genuinely printable, and offers a manual
 * Print button that runs the same checks. Mounted inside the document tree, so it only runs after the document
 * content has been committed; it still verifies visibility because streamed content can sit behind a loading
 * screen. Hidden from printed output.
 */
export function DocumentPrintController({ paperSelector, documentLabel, verifyA4Fit = false, printGeometryAttribute }: {
  paperSelector: string;
  documentLabel: string;
  /** Refuse to print papers taller than A4. */
  verifyA4Fit?: boolean;
  /** When the screen preview differs from print, the html attribute that applies the page's print rules for measuring. */
  printGeometryAttribute?: string;
}) {
  const [readiness, setReadiness] = useState<Readiness>({ state: "waiting", reason: "not_mounted" });
  const [autoPrinted, setAutoPrinted] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const timedOutRef = useRef(false);
  const boxesRef = useRef<string | null>(null);
  const stableFramesRef = useRef(0);

  const check = useCallback((): Readiness => {
    const { snap, boxes } = snapshot(paperSelector, boxesRef.current, verifyA4Fit, printGeometryAttribute);
    // Two unchanged frames in a row before the layout counts as stable.
    stableFramesRef.current = snap.layoutStable ? stableFramesRef.current + 1 : 0;
    boxesRef.current = boxes;
    return evaluateReadiness({ ...snap, layoutStable: stableFramesRef.current >= 2 });
  }, [paperSelector, verifyA4Fit, printGeometryAttribute]);

  useEffect(() => {
    // Lazily loaded images inside the papers would otherwise wait for scrolling and never become ready.
    for (const img of Array.from(document.querySelectorAll<HTMLImageElement>(`${paperSelector} img[loading="lazy"]`))) img.loading = "eager";
    let frame = 0;
    let stopped = false;
    const cap = window.setTimeout(() => { timedOutRef.current = true; setTimedOut(true); }, READINESS_CAP_MS);
    const tick = () => {
      if (stopped) return;
      const next = check();
      setReadiness((prev) => (prev.state === next.state && ("reason" in prev ? prev.reason : "") === ("reason" in next ? next.reason : "") ? prev : next));
      const w = window as MarkedWindow;
      if (shouldAutoPrint({ readiness: next, alreadyAutoPrinted: w[AUTO_PRINT_MARKER] === window.location.pathname, timedOut: timedOutRef.current, documentVisible: document.visibilityState === "visible" })) {
        w[AUTO_PRINT_MARKER] = window.location.pathname;
        setAutoPrinted(true);
        window.print();
      }
      if (next.state === "ready" || next.state === "blocked") return; // settled; the button re-checks on demand
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => { stopped = true; window.cancelAnimationFrame(frame); window.clearTimeout(cap); };
  }, [check, paperSelector]);

  const onPrint = () => {
    // Fresh checks, including stability against the last observed layout; never bypassed.
    stableFramesRef.current = 2;
    const now = check();
    setReadiness(now);
    if (canManuallyPrint(now)) window.print();
  };

  const message = statusMessage({ readiness, autoPrinted, timedOut });
  return (
    <div data-print-hide="" data-document-print-state={readiness.state} data-document-print-reason={"reason" in readiness ? readiness.reason : ""} data-document-auto-printed={autoPrinted ? "true" : "false"}
      style={{ position: "sticky", top: 0, zIndex: 5, maxWidth: 794, margin: "0 auto 12px", padding: "10px 12px", display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", background: "#fff", border: "1px solid #d9e1ea", borderRadius: 8, fontSize: 13, color: "#1a2233" }}>
      <p role="status" aria-live="polite" style={{ margin: 0, flex: "1 1 260px", color: readiness.state === "blocked" ? "#b42318" : "#1a2233" }}>{message}</p>
      <button type="button" className="ta-btn ta-btn-primary ta-btn-touch" onClick={onPrint} disabled={!canManuallyPrint(readiness)} aria-label={`Print or save this ${documentLabel.toLowerCase()} as PDF`}>
        Print / Save as PDF
      </button>
    </div>
  );
}
