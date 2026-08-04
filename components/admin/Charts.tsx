/**
 * Dependency-free SVG charts (server components). No charting library — keeps
 * the bundle small and avoids adding a package. Brand palette by default.
 */
export interface Point { label: string; value: number }

const NAVY = "#0B2C56";
const GOLD = "#E1A925";
const PALETTE = ["#0B2C56", "#E1A925", "#2e9e5b", "#2f6fed", "#a9791a", "#d64545", "#667085", "#7c5cff"];

function niceMax(v: number) {
  if (v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  return Math.ceil(v / pow) * pow;
}

/** Vertical bar chart. */
export function BarChart({ data, height = 220, color = NAVY }: { data: Point[]; height?: number; color?: string }) {
  if (!data.length) return <Empty />;
  const w = Math.max(data.length * 46, 320);
  const pad = { top: 16, right: 12, bottom: 34, left: 34 };
  const max = niceMax(Math.max(...data.map((d) => d.value), 1));
  const chartH = height - pad.top - pad.bottom;
  const bw = (w - pad.left - pad.right) / data.length;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} width="100%" height={height} role="img" aria-label="Bar chart">
      {[0, 0.5, 1].map((t) => {
        const y = pad.top + chartH * (1 - t);
        return <g key={t}><line x1={pad.left} y1={y} x2={w - pad.right} y2={y} stroke="#eceff4" /><text x={4} y={y + 4} fontSize="10" fill="#98a2b3">{Math.round(max * t)}</text></g>;
      })}
      {data.map((d, i) => {
        const h = (d.value / max) * chartH;
        const x = pad.left + i * bw + bw * 0.2;
        const y = pad.top + chartH - h;
        return (
          <g key={i}>
            <rect x={x} y={y} width={bw * 0.6} height={h} rx={3} fill={color} />
            <text x={x + bw * 0.3} y={y - 4} fontSize="10" fill={NAVY} textAnchor="middle">{d.value}</text>
            <text x={x + bw * 0.3} y={height - 18} fontSize="9.5" fill="#667085" textAnchor="middle">{d.label.length > 8 ? d.label.slice(0, 7) + "…" : d.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** Line chart (trend). */
export function LineChart({ data, height = 220, color = GOLD }: { data: Point[]; height?: number; color?: string }) {
  if (!data.length) return <Empty />;
  const w = Math.max(data.length * 46, 320);
  const pad = { top: 16, right: 14, bottom: 34, left: 34 };
  const max = niceMax(Math.max(...data.map((d) => d.value), 1));
  const chartH = height - pad.top - pad.bottom;
  const chartW = w - pad.left - pad.right;
  const x = (i: number) => pad.left + (data.length === 1 ? chartW / 2 : (chartW * i) / (data.length - 1));
  const y = (v: number) => pad.top + chartH * (1 - v / max);
  const pts = data.map((d, i) => `${x(i)},${y(d.value)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${height}`} width="100%" height={height} role="img" aria-label="Line chart">
      {[0, 0.5, 1].map((t) => { const yy = pad.top + chartH * (1 - t); return <line key={t} x1={pad.left} y1={yy} x2={w - pad.right} y2={yy} stroke="#eceff4" />; })}
      <polyline points={pts} fill="none" stroke={color} strokeWidth={2.5} />
      {data.map((d, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(d.value)} r={3.5} fill={color} />
          <text x={x(i)} y={height - 18} fontSize="9.5" fill="#667085" textAnchor="middle">{d.label.length > 7 ? d.label.slice(2) : d.label}</text>
        </g>
      ))}
    </svg>
  );
}

/** Donut chart (breakdown). */
export function DonutChart({ data, size = 180 }: { data: Point[]; size?: number }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (!total) return <Empty />;
  const r = size / 2 - 6, cx = size / 2, cy = size / 2, inner = r * 0.6;
  let a0 = -Math.PI / 2;
  const arcs = data.map((d, i) => {
    const frac = d.value / total;
    const a1 = a0 + frac * 2 * Math.PI;
    const large = frac > 0.5 ? 1 : 0;
    const p = (ang: number, rad: number) => `${cx + rad * Math.cos(ang)},${cy + rad * Math.sin(ang)}`;
    const path = `M ${p(a0, r)} A ${r} ${r} 0 ${large} 1 ${p(a1, r)} L ${p(a1, inner)} A ${inner} ${inner} 0 ${large} 0 ${p(a0, inner)} Z`;
    a0 = a1;
    return { path, color: PALETTE[i % PALETTE.length], label: d.label, value: d.value };
  });
  return (
    <div style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label="Donut chart">
        {arcs.map((a, i) => <path key={i} d={a.path} fill={a.color} />)}
        <text x={cx} y={cy - 2} fontSize="20" fontWeight="700" fill={NAVY} textAnchor="middle">{total}</text>
        <text x={cx} y={cy + 16} fontSize="10" fill="#98a2b3" textAnchor="middle">total</text>
      </svg>
      <div style={{ display: "grid", gap: 6 }}>
        {arcs.map((a, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: a.color, display: "inline-block" }} />
            <span style={{ textTransform: "capitalize" }}>{a.label.replace(/_/g, " ")}</span>
            <strong style={{ marginLeft: "auto" }}>{a.value}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function Empty() {
  return <div style={{ padding: 30, textAlign: "center", color: "var(--ta-muted)", fontSize: 13 }}>No data yet.</div>;
}
