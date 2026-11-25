/**
 * ViewState + group + units → what the map, legend and ring draw.
 * Pure (no React) so every mode can be unit-tested.
 */
import { ABSTAIN_COLOR, DEFAULT_DPP, DEFAULT_KMT, INVALID_COLOR, NEUTRAL, NO_CANDIDATE, OTHER_PARTY, NO_DATA, REF_COLORS, TIE, blackTo, blackScaleEnd, divergingScale, inferno, sequentialScale, shade, type LegendSpec } from "./colors.ts";
import { fmtPct, turnout, type UnitView } from "./results.ts";
import type { ViewState } from "./viewState.ts";
import {
  DPP,
  KMT,
  abstained,
  choiceShare,
  denominatorLabel,
  isMultiContest,
  listSeats,
  localTop,
  partyLabel,
  partyRan,
  partyShare,
  partyVotes,
  referendumDiff,
  seatsByParty,
  showsSeats,
  twoPartyDiff,
  competitionOf,
  uncontestedShare,
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

/** The party picked in the share view: the URL's choice if it is a party here, else the largest real party. */
export function selectedParty(ctx: GroupContext, v: ViewState): string {
  if (v.choice && ctx.party.has(v.choice)) return v.choice;
  return (ctx.partiesByVote.find((p) => !p.isIndependent) ?? ctx.partiesByVote[0]!).id;
}

/** What the share view shows: a party (its candidates combined) or, where offered, one candidate. */
export type ShareTarget = { kind: "party"; id: string } | { kind: "choice"; id: string };

export function selectedTarget(ctx: GroupContext, v: ViewState): ShareTarget {
  if (ctx.referendum) return { kind: "choice", id: v.choice === "disagree" ? "disagree" : "agree" };
  if (ctx.candidatesPickable && v.choice && ctx.choice.has(v.choice)) return { kind: "choice", id: v.choice };
  return { kind: "party", id: selectedParty(ctx, v) };
}

/** Colour of a choice: referendum 同意 / 不同意 by palette, else its party's colour. */
export function choiceColorOf(ctx: GroupContext, id: string, colorblind: boolean): string {
  if (ctx.referendum && (id === "agree" || id === "disagree")) return REF_COLORS[colorblind ? "colorblind" : "normal"][id];
  return ctx.choiceColor.get(id) ?? NEUTRAL;
}

/** Referendums have no 當選 view: a stale "top" falls back to the 同意／不同意 difference. */
/**
 * Referendums have no 當選 view: a stale "top" falls back to the 同意／不同意 difference.
 * 競爭情形 exists only for township and village offices; elsewhere it falls back to the default.
 */
export const effectiveMode = (ctx: GroupContext, v: ViewState): ViewState["mode"] =>
  ctx.referendum && (v.mode === "top" || v.mode === "competition") ? "diff" : v.mode === "competition" && !ctx.localOffice ? "diff" : v.mode;

/** 競爭情形 colours: 同額 stands out; contested races in two steps. */
export const COMPETITION_COLORS = { uncontested: "#5e3c99", close: "#b2abd2", wide: "#e66101" } as const;

export function competitionLabels(ctx: GroupContext) {
  return ctx.singleSeat
    ? { uncontested: "同額競選（1 位候選人）", close: "2 位候選人", wide: "3 位以上候選人" }
    : { uncontested: "同額競選（候選人數 ≤ 應選席次）", close: "每席 2 人以下", wide: "每席超過 2 人" };
}

export function buildMapView(ctx: GroupContext, units: UnitView[], vIn: ViewState): MapViewModel {
  const v = { ...vIn, mode: effectiveMode(ctx, vIn) };
  const den: Denominator = { invalid: v.invalid, abstain: v.abstain };
  const denLabel = denominatorLabel(den, ctx.referendum !== null);
  const colors = new Map<string, string>();
  const hatched = new Set<string>();

  if (v.mode === "competition") {
    const labels = competitionLabels(ctx);
    const single = units.filter((u) => !isMultiContest(u));
    const multi = units.filter(isMultiContest);
    const seen = new Set<string>();
    for (const u of single) {
      const c = u.contestIds[0] ? competitionOf(ctx, u.contestIds[0]) : null;
      if (!c) { colors.set(u.code, NO_DATA); continue; }
      colors.set(u.code, COMPETITION_COLORS[c.kind]);
      seen.add(c.kind);
    }
    // Units spanning several races: the share of them that were 同額.
    const interp = blackTo(COMPETITION_COLORS.uncontested);
    const shares = new Map(multi.map((u) => [u.code, uncontestedShare(u, ctx)]));
    const scale = sequentialScale([...shares.values()].flatMap((x) => (x.share === null ? [] : [x.share])), interp, v.scale, v.max, v.fromZero);
    for (const [code, x] of shares) colors.set(code, x.share === null ? NO_DATA : scale.color(x.share));
    const kinds = (["uncontested", "close", "wide"] as const).filter((k) => seen.has(k));
    return {
      colors,
      hatched,
      legend: multi.length
        ? { title: "同額競選的比例（同額場次 ÷ 場次）", spec: scale.legend, note: "此層級涵蓋多場選舉；「同額」指候選人數不超過應選席次，不需競爭即當選。" }
        : {
            title: ctx.singleSeat ? "競爭情形：候選人數" : "競爭情形：每席候選人數",
            groups: [{ title: "", items: kinds.map((k) => ({ label: labels[k], color: COMPETITION_COLORS[k] })) }],
            note: "同額競選：候選人數不超過應選席次。",
          },
      describe: (u) => {
        if (isMultiContest(u)) {
          const x = uncontestedShare(u, ctx);
          return `同額競選 ${x.uncontested} 場，共 ${x.total} 場（${fmtPct(x.share)}）`;
        }
        const c = u.contestIds[0] ? competitionOf(ctx, u.contestIds[0]) : null;
        return c ? `${labels[c.kind]}：${c.candidates} 位候選人，應選 ${c.seats} 席` : "競爭情形：無資料";
      },
    };
  }

  if (v.mode === "turnout") {
    // 投票率 = 投票數 ÷ 選舉人數 (無效票 and 未投票 are always counted here).
    const interp = v.palette === "party" ? blackTo("#f2f2f2") : inferno;
    const values = new Map(units.map((u) => [u.code, turnout(u.summary)]));
    const scale = sequentialScale([...values.values()].flatMap((x) => (x === null ? [] : [x])), interp, v.scale, v.max, v.fromZero);
    for (const [code, x] of values) colors.set(code, x === null ? NO_DATA : scale.color(x));
    const electors = ctx.referendum ? "投票權人數" : "選舉人數";
    return {
      colors,
      hatched,
      legend: { title: `投票率（投票數 ÷ ${electors}）`, spec: scale.legend },
      describe: (u) => {
        const x = turnout(u.summary);
        return x === null
          ? "投票率：無資料"
          : `投票率 ${fmtPct(x)}：投票數 ${(u.summary.ballotsCast ?? 0).toLocaleString("zh-TW")} ÷ ${electors} ${(u.summary.electors ?? 0).toLocaleString("zh-TW")}`;
      },
    };
  }

  if (v.mode === "diff" && ctx.referendum) {
    const c = REF_COLORS[v.colorblind ? "colorblind" : "normal"];
    const values = new Map(units.map((u) => [u.code, referendumDiff(u, v.formula, den)]));
    const scale = divergingScale(
      [...values.values()].flatMap((r) => (r.value === null ? [] : [r.value])),
      c.disagree,
      c.agree,
      v.scale,
      (pt) => (pt === 0 ? "相同" : pt < 0 ? `不同意 +${-pt}%` : `同意 +${pt}%`),
      v.max,
    );
    for (const [code, r] of values) colors.set(code, r.value === null ? NO_DATA : scale.color(r.value));
    const formulaText = v.formula === "pct" ? `同意% − 不同意%（分母：${denLabel}）` : "(同意 − 不同意) ÷ (同意 + 不同意)";
    return {
      colors,
      hatched,
      legend: { title: `同意與不同意差異：${formulaText}`, spec: scale.legend, note: "地方數值僅供參考；是否通過以全國計算。" },
      describe: (u) => {
        const r = referendumDiff(u, v.formula, den);
        if (r.value === null) return "同意與不同意差異：無資料";
        const lead = r.value > 0 ? "同意較多" : r.value < 0 ? "不同意較多" : "相同";
        return v.formula === "pct"
          ? `同意與不同意差異 ${signedPt(r.value)} 個百分點（${lead}）：同意 ${fmtPct(r.dpp / r.den!)} − 不同意 ${fmtPct(r.kmt / r.den!)}，分母為${denLabel}`
          : `同意與不同意相對差距 ${signedPt(r.value)}%（${lead}）：(${r.dpp.toLocaleString("zh-TW")} − ${r.kmt.toLocaleString("zh-TW")}) ÷ ${(r.dpp + r.kmt).toLocaleString("zh-TW")}`;
      },
    };
  }

  if (v.mode === "diff") {
    const kmtName = ctx.party.get(KMT)?.nameZh ?? "中國國民黨";
    const dppName = ctx.party.get(DPP)?.nameZh ?? "民主進步黨";
    const values = new Map(units.map((u) => [u.code, twoPartyDiff(u, ctx, v.formula, den)]));
    const scale = divergingScale(
      [...values.values()].flatMap((r) => (r.value === null ? [] : [r.value])),
      blackScaleEnd(ctx.party.get(KMT)?.color ?? DEFAULT_KMT),
      blackScaleEnd(ctx.party.get(DPP)?.color ?? DEFAULT_DPP),
      v.scale,
      (pt) => (pt === 0 ? "平手" : pt < 0 ? `國 +${-pt}%` : `民 +${pt}%`),
      v.max,
    );
    // Neither party ran here: no comparison (無候選人), not a 0 − 0 tie.
    const neither = new Set(units.filter((u) => !partyRan(u, ctx, DPP) && !partyRan(u, ctx, KMT)).map((u) => u.code));
    for (const [code, r] of values) colors.set(code, neither.has(code) ? NO_CANDIDATE : r.value === null ? NO_DATA : scale.color(r.value));
    const formulaText = v.formula === "pct" ? `民進黨% − 國民黨%（分母：${denLabel}）` : "(民進黨 − 國民黨) ÷ (民進黨 + 國民黨)";
    return {
      colors,
      hatched,
      legend: {
        title: `兩大黨差異：${formulaText}`,
        spec: scale.legend,
        groups: neither.size ? [{ title: "其他", items: [{ label: "兩黨皆無候選人", color: NO_CANDIDATE }] }] : undefined,
        note: `國＝${kmtName}，民＝${dppName}。各黨候選人票數合計；只有一黨有候選人時，另一黨以 0 票計。`,
      },
      describe: (u) => {
        if (neither.has(u.code)) return "兩大黨差異：民進黨與國民黨在此皆無候選人";
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
    const multi = units.some((u) => showsSeats(u, ctx));
    const strengths: { code: string; color: string; s: number | null }[] = [];
    const legendTop = new Map<string, { elected: boolean; unelected: boolean }>(); // partyId → seen
    let ties = 0;
    for (const u of units) {
      if (showsSeats(u, ctx) && ctx.live) {
        // No seats are decided while counting: colour by the party with the most votes.
        const pv = ctx.partiesByVote.map((p) => [p.id, partyVotes(u, ctx, p.id)] as const);
        const top = Math.max(0, ...pv.map(([, n]) => n));
        const leaders = pv.filter(([, n]) => n === top);
        const sum = pv.reduce((a, [, n]) => a + n, 0);
        if (top === 0 || leaders.length !== 1) {
          if (top > 0) ties++;
          colors.set(u.code, top > 0 ? TIE : NO_DATA);
          continue;
        }
        const pid = leaders[0]![0];
        strengths.push({ code: u.code, color: ctx.partyColor.get(pid) ?? NEUTRAL, s: sum ? top / sum : null });
        legendTop.set(pid, { elected: true, unelected: false });
        continue;
      }
      if (showsSeats(u, ctx)) {
        const r = seatsByParty(u, ctx);
        if (!r.partyId) {
          if (r.total > 0) ties++;
          colors.set(u.code, r.total > 0 ? TIE : NO_DATA);
          continue;
        }
        strengths.push({ code: u.code, color: ctx.partyColor.get(r.partyId) ?? NEUTRAL, s: r.total ? (r.seats.get(r.partyId) ?? 0) / r.total : null });
        const seen = legendTop.get(r.partyId) ?? { elected: false, unelected: false };
        legendTop.set(r.partyId, { ...seen, elected: true });
        continue;
      }
      const t = localTop(u, ctx, den);
      if (!t.choiceId) {
        const tied = Object.values(u.votes).some((x) => x > 0);
        if (tied) ties++;
        colors.set(u.code, tied ? TIE : NO_DATA);
        continue;
      }
      strengths.push({ code: u.code, color: ctx.choiceColor.get(t.choiceId)!, s: t.share });
      if (!ctx.live && !t.elected && v.hatchUnelected) hatched.add(u.code);
      const p = ctx.choice.get(t.choiceId)?.partyId ?? "none";
      const seen = legendTop.get(p) ?? { elected: false, unelected: false };
      legendTop.set(p, t.elected ? { ...seen, elected: true } : { ...seen, unelected: true });
    }
    const seq = sequentialScale(strengths.flatMap((x) => (x.s === null ? [] : [x.s])), (t) => String(t), v.scale, null, v.fromZero);
    for (const x of strengths) colors.set(x.code, v.shadeTop && x.s !== null ? shade(x.color, seq.t(x.s)) : x.color);
    const item = (p: string, hatch: boolean): LegendItem => ({ label: partyLabel(ctx, p), color: ctx.partyColor.get(p) ?? NEUTRAL, hatched: hatch && v.hatchUnelected });
    const parties = ctx.partiesByVote.map((p) => p.id).filter((p) => legendTop.has(p));
    const groups = ctx.live
      ? [{ title: multi ? "得票最多的政黨" : "目前領先", items: parties.map((p) => item(p, false)) }]
      : multi
      ? [{ title: "最多席次的政黨", items: parties.map((p) => item(p, false)) }]
      : [
          { title: ctx.partyList ? "獲得席次" : "當選", items: parties.filter((p) => legendTop.get(p)!.elected).map((p) => item(p, false)) },
          { title: `${ctx.partyList ? "未獲席次" : "未當選"}${v.hatchUnelected ? "（斜線）" : ""}`, items: parties.filter((p) => legendTop.get(p)!.unelected).map((p) => item(p, true)) },
        ].filter((g) => g.items.length);
    if (ties) groups.push({ title: "其他", items: [{ label: multi ? "最多席次的政黨同席次" : "得票最多者同票", color: TIE }] });
    return {
      colors,
      hatched,
      legend: {
        title: ctx.live ? "各地區目前得票最多者（依政黨著色；開票中，非當選結果）" : multi ? "當選席次最多的政黨" : ctx.partyList ? "各地區得票最多的政黨" : "各地區得票最多的候選人（依政黨著色）",
        groups,
        note: [
          v.shadeTop ? (multi ? "顏色越深，該黨席次占比越高。" : `顏色越深，${ctx.partyList ? "該黨" : "該候選人"}得票率越高（分母：${denLabel}）。`) : "",
          ctx.partyList ? `席次依全國得票分配（門檻 ${ctx.partyList.thresholdPct}%），地區得票最多不代表在該地區獲得席次。` : "",
        ].filter(Boolean).join("") || undefined,
      },
      describe: (u) => {
        if (showsSeats(u, ctx) && ctx.live) {
          const pv = ctx.partiesByVote.map((p) => ({ p, n: partyVotes(u, ctx, p.id) })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
          if (!pv.length) return "目前得票最多的政黨：無資料";
          if (pv.length > 1 && pv[1]!.n === pv[0]!.n) return "目前得票最多的政黨同票（開票中）";
          return `目前得票最多的政黨：${pv[0]!.p.nameZh}（開票中，非當選結果）`;
        }
        if (showsSeats(u, ctx)) {
          const r = seatsByParty(u, ctx);
          const list = ctx.partiesByVote.filter((p) => r.seats.get(p.id)).map((p) => `${p.nameZh} ${r.seats.get(p.id)}`).join("、");
          return `當選席次（共 ${r.total} 席）：${list || "無"}`;
        }
        const t = localTop(u, ctx, den);
        if (!t.choiceId) return Object.values(u.votes).some((x) => x > 0) ? "得票最多者同票" : "得票最多：無資料";
        const c = ctx.choice.get(t.choiceId)!;
        if (ctx.partyList) {
          const n = c.partyId ? listSeats(ctx, c.partyId) : 0;
          return `得票最多：${c.labelZh}（${fmtPct(t.share)}，分母為${denLabel}），全國${n ? `獲 ${n} 席` : "未獲席次"}`;
        }
        if (ctx.live) return `目前領先：${c.labelZh}（${fmtPct(t.share)}，分母為${denLabel}；開票中，非當選結果）`;
        return `得票最多：${c.labelZh}（${fmtPct(t.share)}，分母為${denLabel}）${t.elected ? "，當選" : "，未當選"}`;
      },
    };
  }

  // share: one party (its candidates combined), or one candidate where candidates are pickable
  const target = selectedTarget(ctx, v);
  const isChoice = target.kind === "choice";
  const pc = isChoice ? ctx.choice.get(target.id)! : null;
  const label = pc ? (ctx.referendum ? pc.labelZh : `${pc.labelZh}（${pc.partyId ? (ctx.party.get(pc.partyId)?.nameZh ?? "") : ""}）`) : partyLabel(ctx, target.id);
  const baseColor = pc ? choiceColorOf(ctx, pc.id, v.colorblind) : (ctx.partyColor.get(target.id) ?? NEUTRAL);
  const interp = v.palette === "party" ? blackTo(blackScaleEnd(baseColor)) : inferno;
  const ranHere = (u: UnitView) => (pc ? u.contestIds.includes(pc.contestId) : partyRan(u, ctx, target.id));
  const shareOf = (u: UnitView) => (pc ? choiceShare(u, pc.id, den) : partyShare(u, ctx, target.id, den));
  const votesOf = (u: UnitView) => (pc ? (u.votes[pc.id] ?? 0) : partyVotes(u, ctx, target.id));
  // Units where the party ran no candidate are 無候選人, not 0%, and stay out of the scale's range.
  const ran = new Set(units.filter(ranHere).map((u) => u.code));
  const values = new Map(units.filter((u) => ran.has(u.code)).map((u) => [u.code, shareOf(u)]));
  const scale = sequentialScale([...values.values()].flatMap((x) => (x === null ? [] : [x])), interp, v.scale, v.max, v.fromZero);
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
      ranHere(u)
        ? `${label} 得票率 ${fmtPct(shareOf(u))}（${votesOf(u).toLocaleString("zh-TW")} 票，分母為${denLabel}）`
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
 * One slice order everywhere, so a party keeps its place across areas and years: 民主進步黨,
 * 台灣民眾黨, 中國國民黨, then other parties by the group's national votes, 無黨籍 last.
 * Referendums: 同意 then 不同意 (the threshold marker measures from 同意's start).
 */
export const RING_FIRST = [DPP, "cec-350", KMT];
export function partyRank(ctx: GroupContext, partyId: string | null): number {
  if (!partyId) return 9999;
  const fixed = RING_FIRST.indexOf(partyId);
  if (fixed >= 0) return fixed;
  if (ctx.party.get(partyId)?.isIndependent) return 9000;
  const i = ctx.partiesByVote.findIndex((p) => p.id === partyId);
  return 100 + (i < 0 ? 999 : i);
}

/**
 * Ring for one unit: candidates for a single-contest unit; parties for a unit spanning several
 * contests or for 不分區政黨票 (parties under 2% are grouped as 其他); plus 無效 / 未投票 when counted.
 */
export function ringSlices(u: UnitView, ctx: GroupContext, d: Denominator, colorblind = false): RingSlice[] {
  let slices: RingSlice[];
  if (!isMultiContest(u) && !ctx.partyList) {
    slices = Object.entries(u.votes).map(([id, v]) => ({ key: id, label: ctx.choice.get(id)?.labelZh ?? id, value: v, color: choiceColorOf(ctx, id, colorblind) }));
    const order = (k: string) => {
      if (k === "agree") return 0;
      if (k === "disagree") return 1;
      const c = ctx.choice.get(k);
      return partyRank(ctx, c?.partyId ?? null) * 1000 + (c?.ballotNumber ?? 0); // same party: by ballot number
    };
    slices.sort((a, b) => order(a.key) - order(b.key));
  } else {
    const valid = u.summary.valid ?? 0;
    const big: RingSlice[] = [];
    let other = 0;
    for (const p of [...ctx.partiesByVote].sort((a, b) => partyRank(ctx, a.id) - partyRank(ctx, b.id))) {
      const v = partyVotes(u, ctx, p.id);
      if (!v) continue;
      if (valid && v / valid < 0.02) other += v;
      else big.push({ key: p.id, label: p.nameZh, value: v, color: ctx.partyColor.get(p.id) ?? NEUTRAL });
    }
    slices = other ? [...big, { key: "other", label: "其他", value: other, color: OTHER_PARTY }] : big;
  }
  if (d.invalid) slices.push({ key: "invalid", label: "無效票", value: u.summary.invalid ?? 0, color: INVALID_COLOR });
  if (d.abstain) slices.push({ key: "abstain", label: "未投票", value: abstained(u.summary) ?? 0, color: ABSTAIN_COLOR });
  return slices;
}

