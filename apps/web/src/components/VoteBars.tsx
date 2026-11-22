import { scaleLinear } from "d3-scale";
import { fmtInt, fmtPct } from "../lib/results.ts";

export interface BarDatum {
  key: string;
  label: string;
  sublabel: string;
  votes: number;
  share: number | null;
  color: string;
  highlight: boolean;
}

/** Horizontal share bars. Denominator is always valid ballots — stated by the caller. */
export function VoteBars({ data }: { data: BarDatum[] }) {
  const width = 320;
  const barH = 14;
  const rowH = 46;
  const x = scaleLinear().domain([0, 1]).range([0, width]);
  return (
    <svg viewBox={`0 0 ${width} ${rowH * data.length}`} width="100%" role="img" aria-label="各候選人得票率">
      {data.map((d, i) => (
        <g key={d.key} transform={`translate(0, ${i * rowH})`}>
          <text x={0} y={13} fontSize={13} fontWeight={d.highlight ? 700 : 400} fill="currentColor">
            {d.label}
          </text>
          <text x={width} y={13} fontSize={12} textAnchor="end" fill="currentColor">
            {fmtPct(d.share)}
          </text>
          <rect x={0} y={19} width={width} height={barH} rx={2} fill="currentColor" opacity={0.08} />
          <rect x={0} y={19} width={d.share === null ? 0 : x(d.share)} height={barH} rx={2} fill={d.color} />
          <text x={0} y={44} fontSize={11} fill="currentColor" opacity={0.7}>
            {d.sublabel}・{fmtInt(d.votes)} 票
          </text>
        </g>
      ))}
    </svg>
  );
}
