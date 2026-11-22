/**
 * Shareable view state lives in the URL hash ("#/?c=...&lv=town&ch=n2&m=share&u=town:63000010").
 * Hash-based so GitHub Pages needs no SPA fallback for deep links.
 */
import { useCallback, useSyncExternalStore } from "react";

export type MapLevel = "county" | "town";
export type ColorMode = "share" | "leader";

export interface ViewState {
  contest: string | null;
  level: MapLevel;
  choice: string | null;
  mode: ColorMode;
  unit: string | null;
}

const KEYS = { contest: "c", level: "lv", choice: "ch", mode: "m", unit: "u" } as const;

export function parseHash(hash: string): ViewState {
  const q = new URLSearchParams(hash.replace(/^#\/?\??/, ""));
  const lv = q.get(KEYS.level);
  const m = q.get(KEYS.mode);
  return {
    contest: q.get(KEYS.contest),
    level: lv === "county" ? "county" : "town",
    choice: q.get(KEYS.choice),
    mode: m === "leader" ? "leader" : "share",
    unit: q.get(KEYS.unit),
  };
}

export function formatHash(s: ViewState): string {
  const q = new URLSearchParams();
  for (const [k, short] of Object.entries(KEYS) as [keyof ViewState, string][]) {
    const v = s[k];
    if (v !== null && v !== undefined && v !== "") q.set(short, String(v));
  }
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
