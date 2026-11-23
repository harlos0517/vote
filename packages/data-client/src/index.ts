/**
 * Typed, validated access to the static data layout (see @tw-election/schema files.ts).
 * Framework-agnostic: the web app wraps these in TanStack Query.
 */
import type { z } from "zod";
import {
  DATA_PREFIX,
  GroupMetadataFile,
  GroupResultsFile,
  Manifest,
  PartiesFile,
  ReleaseIndexFile,
  SCHEMA_VERSION,
} from "@tw-election/schema";

export type DataErrorKind = "network" | "http" | "parse" | "schema" | "schema-version";

export class DataError extends Error {
  constructor(
    readonly kind: DataErrorKind,
    readonly url: string,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "DataError";
  }
}

export interface FeatureCollection {
  type: "FeatureCollection";
  features: { type: "Feature"; properties: Record<string, string>; geometry: unknown }[];
}

export const paths = {
  manifest: () => `${DATA_PREFIX}/manifest.json`,
  release: (release: string, rel: string) => `${DATA_PREFIX}/releases/${release}/${rel}`,
  index: (release: string) => paths.release(release, "index.json"),
  parties: (release: string) => paths.release(release, "parties.json"),
  group: (release: string, groupId: string) => paths.release(release, `groups/${groupId}/metadata.json`),
};

export interface DataClient {
  manifest(): Promise<z.infer<typeof Manifest>>;
  index(release: string): Promise<z.infer<typeof ReleaseIndexFile>>;
  parties(release: string): Promise<z.infer<typeof PartiesFile>>;
  group(release: string, groupId: string): Promise<z.infer<typeof GroupMetadataFile>>;
  /** `path` is release-relative, taken from GroupMetadataFile.results[level]. */
  results(release: string, path: string): Promise<z.infer<typeof GroupResultsFile>>;
  /** `path` is release-relative, taken from GroupMetadataFile.boundary.files[level]. */
  geography(release: string, path: string): Promise<FeatureCollection>;
}

export function createDataClient(baseUrl: string, fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)): DataClient {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;

  async function getJson(rel: string, init?: RequestInit): Promise<unknown> {
    const url = base + rel;
    let res: Response;
    try {
      res = await fetchImpl(url, init);
    } catch (e) {
      throw new DataError("network", url, `無法連線取得資料：${(e as Error).message}`);
    }
    if (!res.ok) throw new DataError("http", url, `資料請求失敗（HTTP ${res.status}）`, res.status);
    try {
      return await res.json();
    } catch {
      throw new DataError("parse", url, "資料格式錯誤（不是有效的 JSON）");
    }
  }

  async function getParsed<S extends z.ZodType>(schema: S, rel: string, init?: RequestInit): Promise<z.infer<S>> {
    const raw = await getJson(rel, init);
    const v = (raw as { schemaVersion?: unknown } | null)?.schemaVersion;
    if (v !== undefined && v !== SCHEMA_VERSION) {
      throw new DataError("schema-version", base + rel, `資料版本 ${String(v)} 與本網站支援的版本 ${SCHEMA_VERSION} 不符，請重新整理頁面。`);
    }
    const r = schema.safeParse(raw);
    if (!r.success) throw new DataError("schema", base + rel, `資料未通過格式驗證：${r.error.issues[0]?.message ?? ""}`);
    return r.data;
  }

  return {
    // The manifest is the only mutable file: always revalidate it.
    manifest: () => getParsed(Manifest, paths.manifest(), { cache: "no-cache" }),
    index: (release) => getParsed(ReleaseIndexFile, paths.index(release)),
    parties: (release) => getParsed(PartiesFile, paths.parties(release)),
    group: (release, id) => getParsed(GroupMetadataFile, paths.group(release, id)),
    results: (release, path) => getParsed(GroupResultsFile, paths.release(release, path)),
    geography: async (release, path) => {
      const raw = (await getJson(paths.release(release, path))) as FeatureCollection;
      if (raw?.type !== "FeatureCollection" || !Array.isArray(raw.features)) {
        throw new DataError("schema", base + paths.release(release, path), "圖資格式錯誤");
      }
      return raw;
    },
  };
}
