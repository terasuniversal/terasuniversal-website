/** Sanitize free-text input before interpolating it into a PostgREST .or() filter. */
export function sanitizeSearchTerm(value: string): string {
  return value.replace(/[%_,()]/g, " ").trim();
}
