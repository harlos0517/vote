/**
 * ViewState + contest + units → what the map and legend draw.
 * Pure (no React) so every mode can be unit-tested.
 */
import type { ContestMetadataFile } from "@tw-election/schema";
import {
  DEFAULT_DPP,
  DEFAULT_KMT,
  NO_DATA,
  blackTo,
  divergingScale,
  sequentialScale,
  shade,
  viridis,
  type LegendSpec,
} from "./colors.ts";
import { fmtPct, type UnitView } from "./results.ts";
import type { ViewState } from "./viewState.ts";
import {
  DPP,
  KMT,
  choiceColors,
  denominatorLabel,
  electedByChoice,
  localTop,
  partyColor,
  shareOf,
  twoPartyDiff,
  type Denominator,
} from "./views.ts";

export interface LegendItem {
  label: string;
  color: string;
  hatched?: boolean;
}

export interface LegendModel {
  title: string;
  spec?: LegendSpec;
  groups?: { title: string; items: LegendItem[] }[];
  note?: string;
}

export interface MapViewModel {
  colors: Map<string, string>;
  hatched: Set<string>;
  legend: LegendModel;
  /** One-line explanation of this unit's value in the current view (sidebar "目前檢視"). */
  describe: (u: UnitView) => string;
}

const signedPt = (x: number) => `${x > 0 ? "+" : ""}${(x * 100).toFixed(2)}`;

export function buildMapView(meta: ContestMetadataFile, units: UnitView[], v: ViewState): MapViewModel {
  const den: Denominator = { invalid: v.invalid, abstain: v.abstain };
  const denLabel = denominatorLabel(den);
  const choices = meta.choices;
  const colorsByChoice = choiceColors(meta);
  const colors = new Map<string, string>();
  const hatched = new Set<string>();

  if (v.mode === "diff") {
    const kmtName = meta.parties.find((p) => p.id === KMT)?.nameZh ?? "中國國民黨";
    const dppName = meta.parties.find((p) => p.id === DPP)?.nameZh ?? "民主進步黨";
    const values = new Map(units.map((u) => [u.code, twoPartyDiff(u, choices, v.formula, den)]));
    const scale = divergingScale(
      [...values.values()].flatMap((r) => (r.value === null ? [] : [r.value])),
      partyColor(meta, KMT) ?? DEFAULT_KMT,
      partyColor(meta, DPP) ?? DEFAULT_DPP,
      v.scale,
      (pt) => (pt === 0 ? "平手" : pt < 0 ? `國 +${-pt}%` : `民 +${pt}%`),
    );
    for (const [code, r] of values) colors.set(code, r.value === null ? NO_DATA : scale.color(r.value));
    const formulaText =
      v.formula === "pct" ? `民進黨% − 國民黨%（分母：${denLabel}）` : "(民進黨 − 國民黨) ÷ (民進黨 + 國民黨)";
    return {
      colors,
      hatched,
      legend: {
        title: `兩大黨差異：${formulaText}`,
        spec: scale.legend,
        note: `國＝${kmtName}，民＝${dppName}。某黨無候選人時以 0 票計。`,
      },
      describe: (u) => {
        const r = twoPartyDiff(u, choices, v.formula, den);
        if (r.value === null) return "兩大黨差異：無資料";
        const lead = r.value > 0 ? "民進黨領先" : r.value < 0 ? "國民黨領先" : "平手";
        return v.formula === "pct"
          ? `兩大黨差異 ${signedPt(r.value)} 個百分點（${lead}）：民進黨 ${fmtPct(r.dpp / r.den!)} − 國民黨 ${fmtPct(r.kmt / r.den!)}，分母為${denLabel}`
          : `兩大黨相對差距 ${signedPt(r.value)}%（${lead}）：(${r.dpp.toLocaleString("zh-TW")} − ${r.kmt.toLocaleString("zh-TW")}) ÷ ${(r.dpp + r.kmt).toLocaleString("zh-TW")}`;
      },
    };
  }

  if (v.mode === "top") {
    const elected = electedByChoice(meta);
    const tops = new Map(units.map((u) => [u.code, localTop(u, elected, den)]));
    const shares = [...tops.values()].flatMap((t) => (t.share === null ? [] : [t.share]));
    const seq = sequentialScale(shares, (t) => String(t), v.scale);
    const seen = new Set<number>();
    for (const [code, t] of tops) {
      if (t.index === null) {
        colors.set(code, NO_DATA);
        continue;
      }
      seen.add(t.index);
      const base = colorsByChoice[t.index]!;
      colors.set(code, v.shadeTop && t.share !== null ? shade(base, seq.t(t.share)) : base);
      if (!t.elected) hatched.add(code);
    }
    const item = (i: number): LegendItem => ({ label: `${choices[i]!.ballotNumber} ${choices[i]!.labelZh}`, color: colorsByChoice[i]!, hatched: !elected[i] });
    const shown = choices.map((_, i) => i).filter((i) => seen.has(i));
    return {
      colors,
      hatched,
      legend: {
        title: "各地區得票最多的候選人",
        groups: [
          { title: "當選", items: shown.filter((i) => elected[i]).map(item) },
          { title: "未當選（斜線）", items: shown.filter((i) => !elected[i]).map(item) },
        ].filter((g) => g.items.length),
        note: v.shadeTop ? `顏色越深，該候選人得票率越高（分母：${denLabel}）。` : undefined,
      },
      describe: (u) => {
        const t = localTop(u, elected, den);
        if (t.index === null) return "得票最多：同票或無資料";
        return `得票最多：${choices[t.index]!.labelZh}（${fmtPct(t.share)}，分母為${denLabel}）${t.elected ? "，當選" : "，未當選"}`;
      },
    };
  }

  // share
  const idx = Math.max(0, choices.findIndex((c) => c.id === v.choice));
  const choice = choices[idx]!;
  const interp = v.palette === "party" ? blackTo(colorsByChoice[idx]!) : viridis;
  const values = new Map(units.map((u) => [u.code, shareOf(u, idx, den)]));
  const scale = sequentialScale([...values.values()].flatMap((x) => (x === null ? [] : [x])), interp, v.scale);
  for (const [code, s] of values) colors.set(code, s === null ? NO_DATA : scale.color(s));
  return {
    colors,
    hatched,
    legend: { title: `${choice.labelZh} 得票率（分母：${denLabel}）`, spec: scale.legend },
    describe: (u) => `${choice.labelZh} 得票率 ${fmtPct(shareOf(u, idx, den))}（分母為${denLabel}）`,
  };
}
