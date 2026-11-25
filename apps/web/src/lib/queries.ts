import { QueryClient, useQuery } from "@tanstack/react-query";
import { createDataClient, DataError } from "@tw-election/data-client";

/** Production: R2 custom domain. Dev/preview: ETL output served by vite at <base>/data/. */
export const DATA_BASE_URL: string = import.meta.env.VITE_DATA_BASE_URL || `${import.meta.env.BASE_URL}data/`;

export const client = createDataClient(DATA_BASE_URL);

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Release paths are immutable: never refetch once loaded.
      staleTime: Infinity,
      gcTime: 30 * 60_000,
      refetchOnWindowFocus: false,
      retry: (count, err) => {
        if (err instanceof DataError && err.kind !== "network" && !(err.kind === "http" && (err.status ?? 0) >= 500)) return false;
        return count < 2;
      },
    },
  },
});

export const useManifest = () =>
  useQuery({ queryKey: ["manifest"], queryFn: () => client.manifest(), staleTime: 5 * 60_000 });

export const useReleaseIndex = (release: string | undefined) =>
  useQuery({ queryKey: ["index", release], queryFn: () => client.index(release!), enabled: !!release });

export const useGroup = (release: string | undefined, groupId: string | null) =>
  useQuery({
    queryKey: ["group", release, groupId],
    queryFn: () => client.group(release!, groupId!),
    enabled: !!release && !!groupId,
  });

export const useResults = (release: string | undefined, path: string | undefined) =>
  useQuery({ queryKey: ["results", release, path], queryFn: () => client.results(release!, path!), enabled: !!release && !!path });

export const useGeography = (release: string | undefined, path: string | undefined) =>
  useQuery({ queryKey: ["geo", release, path], queryFn: () => client.geography(release!, path!), enabled: !!release && !!path });

// --- live feeds (docs/live-feed.md) --------------------------------------------------------

/** Minimum poll interval, whatever a manifest asks for. */
const MIN_POLL_MS = 15_000;
const pollMs = (seconds: number | undefined) => Math.max(MIN_POLL_MS, (seconds ?? 60) * 1000);

export const useLiveManifest = (feedId: string | null) =>
  useQuery({
    queryKey: ["live-manifest", feedId],
    queryFn: () => client.liveManifest(feedId!),
    enabled: !!feedId,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: (q) => pollMs(q.state.data?.pollIntervalSeconds),
  });

export const useLiveSnapshot = (feedId: string | null, path: string | undefined, pollSeconds: number | undefined) =>
  useQuery({
    queryKey: ["live-snapshot", feedId, path],
    queryFn: () => client.liveSnapshot(feedId!, path!),
    enabled: !!feedId && !!path,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: pollMs(pollSeconds),
  });

type MetadataRef = { release: string; path: string } | { feedPath: string; geographyRelease: string };

/** Group metadata from a release, or carried by the feed itself (pre-election groups). */
export const useLiveGroup = (feedId: string | null, groupId: string | null, ref: MetadataRef | undefined) =>
  useQuery({
    queryKey: ["live-group", feedId, groupId, ref],
    queryFn: () => ("release" in ref! ? client.group(ref!.release, groupId!) : client.liveGroup(feedId!, ref!.feedPath)),
    enabled: !!feedId && !!groupId && !!ref,
  });

/** Unit lists for a live group: the release's results files, or the feed's units files. */
export const useLiveUnits = (feedId: string | null, ref: MetadataRef | undefined, path: string | undefined) =>
  useQuery({
    queryKey: ["live-units", feedId, ref, path],
    queryFn: () => ("release" in ref! ? client.results(ref!.release, path!) : client.liveUnits(feedId!, path!)),
    enabled: !!feedId && !!ref && !!path,
  });

export const geographyReleaseOf = (ref: MetadataRef | undefined) => (ref ? ("release" in ref ? ref.release : ref.geographyRelease) : undefined);
