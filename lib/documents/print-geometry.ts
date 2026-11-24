/**
 * Print-geometry CSS used twice: inside `@media print`, and scoped under `html[<attribute>]` so
 * DocumentPrintController can apply the exact print rules for one synchronous measurement (no paint happens
 * between setting and removing the attribute). This keeps a single source for the printed layout.
 *
 * Only flat rule lists are supported (`selector{declarations}`), which is what the document pages use.
 */
export const PRINT_GEOMETRY_ATTRIBUTE = "data-print-geometry";

export function scopePrintGeometry(css: string, attribute: string = PRINT_GEOMETRY_ATTRIBUTE): string {
  const root = `html[${attribute}]`;
  return css.replace(/([^{}]+)\{([^{}]*)\}/g, (_rule, selectors: string, declarations: string) => {
    const scoped = selectors.split(",").map((selector) => {
      const s = selector.trim();
      if (!s) return s;
      if (s === "html") return root;
      if (s === "body") return `${root} body`;
      return `${root} ${s}`;
    }).filter(Boolean).join(",");
    return `${scoped}{${declarations}}`;
  });
}
