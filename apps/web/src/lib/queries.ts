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

export const useContest = (release: string | undefined, contestId: string | null) =>
  useQuery({
    queryKey: ["contest", release, contestId],
    queryFn: () => client.contest(release!, contestId!),
    enabled: !!release && !!contestId,
  });

export const useResults = (release: string | undefined, path: string | undefined) =>
  useQuery({ queryKey: ["results", release, path], queryFn: () => client.results(release!, path!), enabled: !!release && !!path });

export const useGeography = (release: string | undefined, path: string | undefined) =>
  useQuery({ queryKey: ["geo", release, path], queryFn: () => client.geography(release!, path!), enabled: !!release && !!path });
