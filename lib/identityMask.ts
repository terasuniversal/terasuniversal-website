/** Masks an identity value for general printable assessment results. */
export function maskIdentification(value: string | null | undefined): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "—";
  if (normalized.length <= 4) {
    return `${"•".repeat(Math.max(1, normalized.length - 1))}${normalized.slice(-1)}`;
  }
  return `${"•".repeat(normalized.length - 4)}${normalized.slice(-4)}`;
}