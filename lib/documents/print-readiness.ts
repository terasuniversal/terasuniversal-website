/**
 * DOC-2: when may a printable document be printed?
 *
 * The invoice and quotation pages used to call window.print() from an inline
 * script that only waited for fonts and images. Because the pages stream
 * behind the root loading boundary, that script ran while the loading screen
 * still covered the document (11 of 12 local runs), so the print dialog could
 * capture the splash instead of the invoice.
 *
 * These rules are pure so they can be unit-tested; DocumentPrintController
 * gathers the snapshot from the live DOM on every animation frame. A fixed
 * timeout is never the reason to print: READINESS_CAP_MS only ends the
 * automatic attempt (printing is then left to the manual button, which runs
 * the same checks).
 */

export interface ReadinessSnapshot {
  /** Number of document papers found. */
  paperCount: number;
  /** Every paper has a non-zero box and is not inside a [hidden] streaming segment. */
  papersVisible: boolean;
  /** A visible loading screen, or another element on top of the first paper. */
  obstructed: boolean;
  /** document.fonts.status === "loaded". */
  fontsLoaded: boolean;
  /** Images inside the papers that have not finished loading. */
  imagesPending: number;
  /** Images inside the papers that finished without pixels (broken). */
  imagesFailed: number;
  /** Papers taller than one A4 sheet (they would print on extra sheets). */
  overflowingPapers: number;
  /** Paper boxes unchanged since the previous frame. */
  layoutStable: boolean;
}

export type ReadinessReason = "not_mounted" | "obstructed" | "fonts" | "images" | "layout" | "asset_failed" | "layout_overflow";
export type Readiness =
  | { state: "ready" }
  | { state: "waiting"; reason: Exclude<ReadinessReason, "asset_failed" | "layout_overflow"> }
  | { state: "blocked"; reason: "asset_failed" | "layout_overflow" };

/** Ceiling for the automatic attempt. Reaching it never prints; it only stops automatic printing. */
export const READINESS_CAP_MS = 15_000;
/** One A4 sheet at 96 CSS px per inch, plus rounding tolerance. */
export const A4_HEIGHT_PX = 1123;
export const A4_TOLERANCE_PX = 2;

export function evaluateReadiness(s: ReadinessSnapshot): Readiness {
  if (s.imagesFailed > 0) return { state: "blocked", reason: "asset_failed" };
  if (s.paperCount === 0 || !s.papersVisible) return { state: "waiting", reason: "not_mounted" };
  if (s.obstructed) return { state: "waiting", reason: "obstructed" };
  if (!s.fontsLoaded) return { state: "waiting", reason: "fonts" };
  if (s.imagesPending > 0) return { state: "waiting", reason: "images" };
  if (!s.layoutStable) return { state: "waiting", reason: "layout" };
  if (s.overflowingPapers > 0) return { state: "blocked", reason: "layout_overflow" };
  return { state: "ready" };
}

export function shouldAutoPrint(input: { readiness: Readiness; alreadyAutoPrinted: boolean; timedOut: boolean; documentVisible: boolean }): boolean {
  return input.readiness.state === "ready" && !input.alreadyAutoPrinted && !input.timedOut && input.documentVisible;
}

/** The manual button may print again and again, but only when the same checks pass. */
export function canManuallyPrint(readiness: Readiness): boolean {
  return readiness.state === "ready";
}

export const READINESS_MESSAGES: Record<"waiting" | "printed" | "ready" | "timed_out" | "asset_failed" | "layout_overflow", string> = {
  waiting: "Preparing the document for printing…",
  printed: "The print dialog has opened. Use Print / Save as PDF to print again.",
  ready: "Ready to print.",
  timed_out: "Automatic printing was skipped because the document took too long to prepare. Print / Save as PDF becomes available when it is ready.",
  asset_failed: "A logo or image did not load, so this document is not ready to print. Reload the page; if it keeps happening, contact the system administrator.",
  layout_overflow: "This document does not fit its A4 pages, so it was not printed. Do not send it; contact the system administrator.",
};

export function statusMessage(input: { readiness: Readiness; autoPrinted: boolean; timedOut: boolean }): string {
  if (input.readiness.state === "blocked") return READINESS_MESSAGES[input.readiness.reason];
  if (input.readiness.state === "ready") return input.autoPrinted ? READINESS_MESSAGES.printed : READINESS_MESSAGES.ready;
  return input.timedOut ? READINESS_MESSAGES.timed_out : READINESS_MESSAGES.waiting;
}
