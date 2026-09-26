// Every normal watcher polls far more often than this. A stuck promise or a
// stopped loop must not leave the last successful scan green indefinitely.
export const WATCHER_MAX_AGE_MS = 3 * 60_000;

/** A closed staking wall must not strand pending requests or live exits. */
export function watcherChainsForLifecycle(
  enabled: Iterable<string>,
  pendingIntentChains: Iterable<string>,
  activePositionChains: Iterable<string>,
): Set<string> {
  return new Set(
    [...enabled, ...pendingIntentChains, ...activePositionChains]
      .map((chain) => chain.split("-")[0]!)
      .filter(Boolean),
  );
}

type WatcherStatus = {
  chain: string;
  status: "ok" | "unreachable" | "unknown";
  lastError?: string | null;
  lastSuccessAt?: string | null;
};

export function withWatcherFreshness<T extends WatcherStatus>(watcher: T, nowMs = Date.now()): T {
  if (watcher.status !== "ok") return watcher;
  const lastSuccessMs = Date.parse(watcher.lastSuccessAt ?? "");
  if (Number.isFinite(lastSuccessMs) &&
      lastSuccessMs <= nowMs &&
      nowMs - lastSuccessMs <= WATCHER_MAX_AGE_MS) return watcher;
  return {
    ...watcher,
    status: "unreachable",
    lastError: "settlement watcher has not completed a recent scan",
  };
}

/** New native stakes need a working settlement observer before wallet signing. */
export function watcherGateError(
  chain: string,
  watchers: WatcherStatus[],
): string | null {
  const found = watchers.find((entry) => entry.chain === chain);
  const watcher = found ? withWatcherFreshness(found) : undefined;
  if (watcher?.status === "ok") return null;
  if (watcher?.status === "unreachable" && watcher.lastError) {
    return `${chain} settlement watcher is unavailable: ${watcher.lastError}`;
  }
  return `${chain} settlement watcher has not completed a successful scan yet`;
}
