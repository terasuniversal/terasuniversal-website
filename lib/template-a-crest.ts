/**
 * Approved crest used exclusively by Certificate Template A
 * (`professional_scaffold_erection_skills`). Keeping it here ensures the
 * React preview and standalone print/PDF renderer use the exact same artwork.
 */
export function renderTemplateACrestSvg(navy: string, gold: string): string {
  const safeNavy = escapeSvgAttribute(navy);
  const safeGold = escapeSvgAttribute(gold);

  const stars = Array.from({ length: 7 }, (_, index) => {
    const offset = index - 3;
    const x = 100 + offset * 9;
    const y = 65 + Math.abs(offset) * 1.7;
    return `<path d="${starPath(x, y, 3.25, 1.4)}" fill="${safeGold}"/>`;
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 210" role="img" aria-label="TERAS crest" preserveAspectRatio="xMidYMid meet" style="display:block;width:100%;height:100%;">
    <defs>
      <linearGradient id="taCrestGold" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#F5D982"/>
        <stop offset="0.5" stop-color="${safeGold}"/>
        <stop offset="1" stop-color="#A77C16"/>
      </linearGradient>
      <radialGradient id="taCrestNavy" cx="50%" cy="38%" r="65%">
        <stop offset="0" stop-color="#174F7B"/>
        <stop offset="1" stop-color="${safeNavy}"/>
      </radialGradient>
      <path id="taCrestTop" d="M 31 105 A 69 69 0 0 1 169 105" fill="none"/>
      <path id="taCrestBottom" d="M 39 132 A 67 67 0 0 0 161 132" fill="none"/>
      <filter id="taCrestShadow" x="-20%" y="-20%" width="140%" height="155%">
        <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#061D33" flood-opacity="0.28"/>
      </filter>
    </defs>
    <g filter="url(#taCrestShadow)">
      <path d="M72 152 L46 202 L69 190 L78 209 L96 168 Z" fill="url(#taCrestGold)" stroke="${safeNavy}" stroke-width="1.5"/>
      <path d="M128 152 L154 202 L131 190 L122 209 L104 168 Z" fill="url(#taCrestGold)" stroke="${safeNavy}" stroke-width="1.5"/>
      <circle cx="100" cy="100" r="92" fill="url(#taCrestNavy)" stroke="url(#taCrestGold)" stroke-width="4"/>
      <circle cx="100" cy="100" r="82" fill="none" stroke="${safeGold}" stroke-width="1.6"/>
      <circle cx="100" cy="100" r="76" fill="none" stroke="${safeGold}" stroke-width="0.9" opacity="0.72"/>
      ${stars}
      <text font-family="Arial, Helvetica, sans-serif" font-size="9.4" font-weight="800" fill="${safeGold}" letter-spacing="1.15"><textPath href="#taCrestTop" startOffset="50%" text-anchor="middle">BUILDING COMPETENCE</textPath></text>
      <text font-family="Arial, Helvetica, sans-serif" font-size="9.4" font-weight="800" fill="${safeGold}" letter-spacing="1.1"><textPath href="#taCrestBottom" startOffset="50%" text-anchor="middle">CREATING OPPORTUNITIES</textPath></text>
      <g aria-hidden="true">
        <path d="M72 99 H128 M78 89 H122 M84 79 H116 M82 79 V119 M100 70 V119 M118 79 V119 M72 99 L100 70 L128 99 M78 89 L100 119 L122 89" fill="none" stroke="${safeGold}" stroke-width="1.25" stroke-linecap="round" opacity="0.72"/>
        <text x="100" y="108" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="31" font-weight="700" fill="#FFFFFF" stroke="${safeNavy}" stroke-width="1.5" paint-order="stroke">TU</text>
        <line x1="73" y1="119" x2="127" y2="119" stroke="${safeGold}" stroke-width="1"/>
        <text x="100" y="131" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="8.5" font-weight="700" fill="${safeGold}" letter-spacing="1.35">EST. 2012</text>
      </g>
    </g>
  </svg>`;
}

function starPath(cx: number, cy: number, outerRadius: number, innerRadius: number): string {
  const points = Array.from({ length: 10 }, (_, index) => {
    const radius = index % 2 === 0 ? outerRadius : innerRadius;
    const angle = -Math.PI / 2 + index * Math.PI / 5;
    return `${(cx + radius * Math.cos(angle)).toFixed(2)},${(cy + radius * Math.sin(angle)).toFixed(2)}`;
  });
  return `M ${points.join(" L ")} Z`;
}

function escapeSvgAttribute(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] as string);
}
