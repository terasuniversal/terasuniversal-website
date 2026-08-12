"use client";

/**
 * Minimal screen-only print trigger for the attendance sheet. Server
 * components can't attach event handlers, so the print action lives here.
 */
export function PrintButton({ label }: { label: string }) {
  return (
    <button type="button" className="ta-btn ta-btn-primary" onClick={() => window.print()}>
      🖨 {label}
    </button>
  );
}
