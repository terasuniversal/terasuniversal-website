"use client";

export function PrintButton() {
  return (
    <button type="button" className="quote-print-button" onClick={() => window.print()}>
      Print / Save as PDF
    </button>
  );
}
