"use client";

export default function PrintButton() {
  return <button className="btn btn-outline verify-print" type="button" onClick={() => window.print()}>Print Verification Result</button>;
}
