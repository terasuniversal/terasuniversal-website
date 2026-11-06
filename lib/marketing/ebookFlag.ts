/** The /ebook page, the /privacy page and the /api/ebook route stay off (404) unless this is exactly "true". Default: off. */
export function isEbookCaptureEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.EBOOK_LEAD_CAPTURE_ENABLED === "true";
}
