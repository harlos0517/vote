/**
 * Shareable view state lives in the URL hash, e.g.
 *   #/?c=<contest group>&lv=town&m=diff&f=pct&sc=step&inv=1&u=town:63000010
 * Hash-based so GitHub Pages needs no SPA fallback for deep links.
 * Hover is NOT stored here (it is transient); only the locked unit (u) is.
 */
import { useCallback, useSyncExternalStore } from "react";
import type { ScaleKind } from "./colors.ts";
import type { DiffFormula } from "./views.ts";

export type MapLevel = "county" | "district" | "town";
/** diff = 兩大黨差異, top = 當選候選人 (local top), share = 各候選人得票率 */
export type ViewMode = "diff" | "top" | "share";
export type SharePalette = "party" | "multi";

export interface ViewState {
  contest: string | null;
  level: MapLevel;
  mode: ViewMode;
  formula: DiffFormula;
  /** Share view: the selected party id (e.g. "cec-16"). */
  choice: string | null;
  palette: SharePalette;
  scale: ScaleKind;
  invalid: boolean;
  abstain: boolean;
  shadeTop: boolean;
  /** Referendum: blue / orange instead of green / red. */
  colorblind: boolean;
  /** Sequential scales start at 0% instead of the data's low end. */
  fromZero: boolean;
  /** 當選候選人 view: hatch areas whose local top candidate was not elected. */
  hatchUnelected: boolean;
  unit: string | null; // locked unit
}

export const DEFAULT_VIEW: ViewState = {
  contest: null,
  level: "town",
  mode: "diff",
  formula: "pct",
  choice: null,
  palette: "party",
  scale: "continuous",
  invalid: false,
  abstain: false,
  shadeTop: true,
  fromZero: true,
  colorblind: false,
  hatchUnelected: true,
  unit: null,
};

const oneOf = <T extends string>(v: string | null, allowed: readonly T[], dflt: T): T =>
  v !== null && (allowed as readonly string[]).includes(v) ? (v as T) : dflt;
const bool = (v: string | null, dflt: boolean) => (v === "1" ? true : v === "0" ? false : dflt);

export function parseHash(hash: string): ViewState {
  const q = new URLSearchParams(hash.replace(/^#\/?\??/, ""));
  const d = DEFAULT_VIEW;
  const legacyMode = q.get("m") === "leader" ? "top" : q.get("m");
  return {
    contest: q.get("c"),
    level: oneOf(q.get("lv"), ["county", "district", "town"] as const, d.level),
    mode: oneOf(legacyMode, ["diff", "top", "share"] as const, d.mode),
    formula: oneOf(q.get("f"), ["pct", "ratio"] as const, d.formula),
    choice: q.get("ch"),
    palette: oneOf(q.get("pal"), ["party", "multi"] as const, d.palette),
    scale: oneOf(q.get("sc") === "step" ? "stepped" : q.get("sc") === "cont" ? "continuous" : null, ["continuous", "stepped"] as const, d.scale),
    invalid: bool(q.get("inv"), d.invalid),
    abstain: bool(q.get("abs"), d.abstain),
    shadeTop: bool(q.get("sh"), d.shadeTop),
    fromZero: bool(q.get("z"), d.fromZero),
    colorblind: bool(q.get("cb"), d.colorblind),
    hatchUnelected: bool(q.get("ht"), d.hatchUnelected),
    unit: q.get("u"),
  };
}

/** Only non-default values are written, keeping shared links short. */
export function formatHash(s: ViewState): string {
  const q = new URLSearchParams();
  const d = DEFAULT_VIEW;
  if (s.contest) q.set("c", s.contest);
  if (s.level !== d.level) q.set("lv", s.level);
  if (s.mode !== d.mode) q.set("m", s.mode);
  if (s.formula !== d.formula) q.set("f", s.formula);
  if (s.choice) q.set("ch", s.choice);
  if (s.palette !== d.palette) q.set("pal", s.palette);
  if (s.scale !== d.scale) q.set("sc", s.scale === "stepped" ? "step" : "cont");
  if (s.invalid !== d.invalid) q.set("inv", s.invalid ? "1" : "0");
  if (s.abstain !== d.abstain) q.set("abs", s.abstain ? "1" : "0");
  if (s.shadeTop !== d.shadeTop) q.set("sh", s.shadeTop ? "1" : "0");
  if (s.fromZero !== d.fromZero) q.set("z", s.fromZero ? "1" : "0");
  if (s.colorblind !== d.colorblind) q.set("cb", s.colorblind ? "1" : "0");
  if (s.hatchUnelected !== d.hatchUnelected) q.set("ht", s.hatchUnelected ? "1" : "0");
  if (s.unit) q.set("u", s.unit);
  return `#/?${q.toString()}`;
}

const EVENT = "viewstatechange";
const subscribe = (cb: () => void) => {
  window.addEventListener("hashchange", cb);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener("hashchange", cb);
    window.removeEventListener(EVENT, cb);
  };
};

export function useViewState(): [ViewState, (patch: Partial<ViewState>) => void] {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash, () => "");
  const state = parseHash(hash);
  const update = useCallback((patch: Partial<ViewState>) => {
    const next = formatHash({ ...parseHash(window.location.hash), ...patch });
    if (next !== window.location.hash) {
      window.history.replaceState(null, "", next);
      window.dispatchEvent(new Event(EVENT));
    }
  }, []);
  return [state, update];
}
