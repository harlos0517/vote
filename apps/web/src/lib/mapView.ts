/**
 * ViewState + group + units → what the map, legend and ring draw.
 * Pure (no React) so every mode can be unit-tested.
 */
import { ABSTAIN_COLOR, DEFAULT_DPP, DEFAULT_KMT, INVALID_COLOR, NEUTRAL, NO_CANDIDATE, NO_DATA, blackTo, divergingScale, sequentialScale, shade, viridis, type LegendSpec } from "./colors.ts";
import { fmtPct, type UnitView } from "./results.ts";
import type { ViewState } from "./viewState.ts";
import {
  DPP,
  KMT,
  abstained,
  denominatorLabel,
  isMultiContest,
  localTop,
  partyLabel,
  partyRan,
  partyShare,
  partyVotes,
  seatsByParty,
  twoPartyDiff,
  type Denominator,
  type GroupContext,
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

/** The party picked in the share view: the URL's choice if it is a party here, else the largest. */
export function selectedParty(ctx: GroupContext, v: ViewState): string {
  return v.choice && ctx.party.has(v.choice) ? v.choice : ctx.partiesByVote[0]!.id;
}

export function buildMapView(ctx: GroupContext, units: UnitView[], v: ViewState): MapViewModel {
  const den: Denominator = { invalid: v.invalid, abstain: v.abstain };
  const denLabel = denominatorLabel(den);
  const colors = new Map<string, string>();
  const hatched = new Set<string>();

  if (v.mode === "diff") {
    const kmtName = ctx.party.get(KMT)?.nameZh ?? "中國國民黨";
    const dppName = ctx.party.get(DPP)?.nameZh ?? "民主進步黨";
    const values = new Map(units.map((u) => [u.code, twoPartyDiff(u, ctx, v.formula, den)]));
    const scale = divergingScale(
      [...values.values()].flatMap((r) => (r.value === null ? [] : [r.value])),
      ctx.party.get(KMT)?.color ?? DEFAULT_KMT,
      ctx.party.get(DPP)?.color ?? DEFAULT_DPP,
      v.scale,
      (pt) => (pt === 0 ? "平手" : pt < 0 ? `國 +${-pt}%` : `民 +${pt}%`),
    );
    for (const [code, r] of values) colors.set(code, r.value === null ? NO_DATA : scale.color(r.value));
    const formulaText = v.formula === "pct" ? `民進黨% − 國民黨%（分母：${denLabel}）` : "(民進黨 − 國民黨) ÷ (民進黨 + 國民黨)";
    return {
      colors,
      hatched,
      legend: { title: `兩大黨差異：${formulaText}`, spec: scale.legend, note: `國＝${kmtName}，民＝${dppName}。各黨候選人票數合計；某黨無候選人時以 0 票計。` },
      describe: (u) => {
        const r = twoPartyDiff(u, ctx, v.formula, den);
        if (r.value === null) return "兩大黨差異：無資料";
        const lead = r.value > 0 ? "民進黨領先" : r.value < 0 ? "國民黨領先" : "平手";
        return v.formula === "pct"
          ? `兩大黨差異 ${signedPt(r.value)} 個百分點（${lead}）：民進黨 ${fmtPct(r.dpp / r.den!)} − 國民黨 ${fmtPct(r.kmt / r.den!)}，分母為${denLabel}`
          : `兩大黨相對差距 ${signedPt(r.value)}%（${lead}）：(${r.dpp.toLocaleString("zh-TW")} − ${r.kmt.toLocaleString("zh-TW")}) ÷ ${(r.dpp + r.kmt).toLocaleString("zh-TW")}`;
      },
    };
  }

  if (v.mode === "top") {
    // Single-contest units: local top candidate (hatched if not elected).
    // Units spanning several contests (縣市, 全國 of 區域立委): party with the most seats won.
    const multi = units.some(isMultiContest);
    const strengths: { code: string; color: string; s: number | null }[] = [];
    const legendTop = new Map<string, { elected: boolean; unelected: boolean }>(); // partyId → seen
    for (const u of units) {
      if (isMultiContest(u)) {
        const r = seatsByParty(u, ctx);
        if (!r.partyId) { colors.set(u.code, NO_DATA); continue; }
        strengths.push({ code: u.code, color: ctx.partyColor.get(r.partyId) ?? NEUTRAL, s: r.total ? (r.seats.get(r.partyId) ?? 0) / r.total : null });
        const seen = legendTop.get(r.partyId) ?? { elected: false, unelected: false };
        legendTop.set(r.partyId, { ...seen, elected: true });
        continue;
      }
      const t = localTop(u, ctx, den);
      if (!t.choiceId) { colors.set(u.code, NO_DATA); continue; }
      strengths.push({ code: u.code, color: ctx.choiceColor.get(t.choiceId)!, s: t.share });
      if (!t.elected && v.hatchUnelected) hatched.add(u.code);
      const p = ctx.choice.get(t.choiceId)?.partyId ?? "none";
      const seen = legendTop.get(p) ?? { elected: false, unelected: false };
      legendTop.set(p, t.elected ? { ...seen, elected: true } : { ...seen, unelected: true });
    }
    const seq = sequentialScale(strengths.flatMap((x) => (x.s === null ? [] : [x.s])), (t) => String(t), v.scale);
    for (const x of strengths) colors.set(x.code, v.shadeTop && x.s !== null ? shade(x.color, seq.t(x.s)) : x.color);
    const item = (p: string, hatch: boolean): LegendItem => ({ label: partyLabel(ctx, p), color: ctx.partyColor.get(p) ?? NEUTRAL, hatched: hatch && v.hatchUnelected });
    const parties = ctx.partiesByVote.map((p) => p.id).filter((p) => legendTop.has(p));
    const groups = multi
      ? [{ title: "最多席次的政黨", items: parties.map((p) => item(p, false)) }]
      : [
          { title: "當選", items: parties.filter((p) => legendTop.get(p)!.elected).map((p) => item(p, false)) },
          { title: v.hatchUnelected ? "未當選（斜線）" : "未當選", items: parties.filter((p) => legendTop.get(p)!.unelected).map((p) => item(p, true)) },
        ].filter((g) => g.items.length);
    return {
      colors,
      hatched,
      legend: {
        title: multi ? "各縣市當選席次最多的政黨" : "各地區得票最多的候選人（依政黨著色）",
        groups,
        note: v.shadeTop ? (multi ? "顏色越深，該黨席次占比越高。" : `顏色越深，該候選人得票率越高（分母：${denLabel}）。`) : undefined,
      },
      describe: (u) => {
        if (isMultiContest(u)) {
          const r = seatsByParty(u, ctx);
          const list = ctx.partiesByVote.filter((p) => r.seats.get(p.id)).map((p) => `${p.nameZh} ${r.seats.get(p.id)}`).join("、");
          return `當選席次（共 ${r.total} 席）：${list || "無"}`;
        }
        const t = localTop(u, ctx, den);
        if (!t.choiceId) return "得票最多：同票或無資料";
        const c = ctx.choice.get(t.choiceId)!;
        return `得票最多：${c.labelZh}（${fmtPct(t.share)}，分母為${denLabel}）${t.elected ? "，當選" : "，未當選"}`;
      },
    };
  }

  // share: one party (its candidates combined)
  const pid = selectedParty(ctx, v);
  const label = partyLabel(ctx, pid);
  const interp = v.palette === "party" ? blackTo(ctx.partyColor.get(pid) ?? NEUTRAL) : viridis;
  // Units where the party ran no candidate are 無候選人, not 0%, and stay out of the scale's range.
  const ran = new Set(units.filter((u) => partyRan(u, ctx, pid)).map((u) => u.code));
  const values = new Map(units.filter((u) => ran.has(u.code)).map((u) => [u.code, partyShare(u, ctx, pid, den)]));
  const scale = sequentialScale([...values.values()].flatMap((x) => (x === null ? [] : [x])), interp, v.scale);
  for (const u of units) {
    const s = values.get(u.code);
    colors.set(u.code, !ran.has(u.code) ? NO_CANDIDATE : s === null || s === undefined ? NO_DATA : scale.color(s));
  }
  const absent = ran.size < units.length;
  return {
    colors,
    hatched,
    legend: {
      title: `${label} 得票率（分母：${denLabel}）`,
      spec: scale.legend,
      groups: absent ? [{ title: "其他", items: [{ label: "該黨無候選人", color: NO_CANDIDATE }] }] : undefined,
    },
    describe: (u) =>
      partyRan(u, ctx, pid)
        ? `${label} 得票率 ${fmtPct(partyShare(u, ctx, pid, den))}（${partyVotes(u, ctx, pid).toLocaleString("zh-TW")} 票，分母為${denLabel}）`
        : `${label} 在此地區無候選人`,
  };
}

export interface RingSlice {
  key: string;
  label: string;
  value: number;
  color: string;
}

/**
 * Ring for one unit: candidates for a single-contest unit, parties for a unit spanning
 * several contests (parties under 2% are grouped as 其他), plus 無效 / 未投票 when counted.
 */
export function ringSlices(u: UnitView, ctx: GroupContext, d: Denominator): RingSlice[] {
  let slices: RingSlice[];
  if (!isMultiContest(u)) {
    slices = Object.entries(u.votes).map(([id, v]) => ({ key: id, label: ctx.choice.get(id)?.labelZh ?? id, value: v, color: ctx.choiceColor.get(id) ?? NEUTRAL }));
    slices.sort((a, b) => (ctx.choice.get(a.key)?.ballotNumber ?? 0) - (ctx.choice.get(b.key)?.ballotNumber ?? 0));
  } else {
    const valid = u.summary.valid ?? 0;
    const big: RingSlice[] = [];
    let other = 0;
    for (const p of ctx.partiesByVote) {
      const v = partyVotes(u, ctx, p.id);
      if (!v) continue;
      if (valid && v / valid < 0.02) other += v;
      else big.push({ key: p.id, label: p.nameZh, value: v, color: ctx.partyColor.get(p.id) ?? NEUTRAL });
    }
    slices = other ? [...big, { key: "other", label: "其他", value: other, color: NEUTRAL }] : big;
  }
  if (d.invalid) slices.push({ key: "invalid", label: "無效票", value: u.summary.invalid ?? 0, color: INVALID_COLOR });
  if (d.abstain) slices.push({ key: "abstain", label: "未投票", value: abstained(u.summary) ?? 0, color: ABSTAIN_COLOR });
  return slices;
}

