import { arc, pie, type PieArcDatum } from "d3-shape";
import { fmtPct } from "../lib/results.ts";

export interface RingSegment {
  key: string;
  label: string;
  value: number;
  color: string;
}

/** A tick across the ring at `at` (fraction of the full circle, clockwise from the top). */
export interface RingMarker {
  at: number;
  label: string;
}

/** Donut of the hovered / locked / overall area. Segments are drawn in the given order. */
export function VoteRing({ segments, title, subtitle, marker, size = 132 }: { segments: RingSegment[]; title: string; subtitle: string; marker?: RingMarker | null; size?: number }) {
  const r = size / 2;
  const total = segments.reduce((a, s) => a + s.value, 0);
  const arcs = pie<RingSegment>().sort(null).value((s) => s.value)(segments);
  const path = arc<PieArcDatum<RingSegment>>().innerRadius(r * 0.62).outerRadius(r - 2).padAngle(0.008);
  const label = segments.map((s) => `${s.label} ${fmtPct(total ? s.value / total : null, 1)}`).join("、");
  return (
    <svg width={size} height={size} viewBox={`${-r} ${-r} ${size} ${size}`} role="img" aria-label={`${title}：${label}`}>
      {arcs.map((a) => (
        <path key={a.data.key} d={path(a) ?? ""} fill={a.data.color}>
          <title>{`${a.data.label}：${fmtPct(total ? a.data.value / total : null)}`}</title>
        </path>
      ))}
      {marker && marker.at <= 1 && (() => {
        const a = marker.at * 2 * Math.PI;
        const [s, c] = [Math.sin(a), Math.cos(a)];
        const r0 = r * 0.55;
        const r1 = r - 0.5;
        return (
          <line x1={s * r0} y1={-c * r0} x2={s * r1} y2={-c * r1} stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
            <title>{marker.label}</title>
          </line>
        );
      })()}
      <text textAnchor="middle" y={-4} fontSize={12} fontWeight={700} fill="currentColor">
        {title.length > 7 ? `${title.slice(0, 6)}…` : title}
      </text>
      <text textAnchor="middle" y={13} fontSize={10.5} fill="currentColor" opacity={0.75}>
        {subtitle}
      </text>
    </svg>
  );
}
