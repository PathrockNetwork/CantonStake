export type NetworkAvailability = { label: string; tone: "ready" | "waiting" | "unavailable"; detail: string };
export type StatusSnapshot<T> = { data?: T; failed?: boolean; updatedAt?: number };
export type HomeReadiness = {
  status: string; canton: string; networkMode: string; time: string;
  nativeStaking?: Array<{ chain: string; reason: string | null }>;
  loopStaking?: { status: string; supportedChains: string[] };
};
export type HomeWatchers = { networkMode: string; watchers: Array<{ chain: string; status: string; lastSuccessAt: string | null }> };
export const CHECKING: NetworkAvailability = { label: "Checking", tone: "waiting", detail: "Checking current staking availability." };
export const UNKNOWN: NetworkAvailability = { label: "Status unavailable", tone: "unavailable", detail: "Availability could not be verified. Open the route to check again." };
const blocked = (detail: string): NetworkAvailability => ({ label: "Temporarily unavailable", tone: "unavailable", detail });
export function freshSnapshot(snapshot: StatusSnapshot<unknown>, now: number): boolean {
  return !!snapshot.data && !snapshot.failed && !!snapshot.updatedAt && now - snapshot.updatedAt <= 90000 && snapshot.updatedAt <= now + 10000;
}
export function nativeAvailability({ id, configured, adapter, mode, externalLoop, readiness, watchers, catalog, now = Date.now() }: {
  id: string; configured: boolean; adapter: boolean; mode: string; externalLoop: boolean;
  readiness: StatusSnapshot<HomeReadiness>; watchers: StatusSnapshot<HomeWatchers>;
  catalog: StatusSnapshot<{ chains: Array<{ chain: string }> }>; now?: number;
}): NetworkAvailability {
  if (!configured || !adapter) return { label: "Not enabled", tone: "waiting", detail: "This network is not enabled on this deployment." };
  const snapshots = [readiness, watchers, catalog];
  if (snapshots.some(s => s.failed || (s.data && !freshSnapshot(s, now)))) return UNKNOWN;
  if (snapshots.some(s => !s.data)) return CHECKING;
  const r = readiness.data!, w = watchers.data!;
  if (r.networkMode !== mode || w.networkMode !== mode || !Array.isArray(w.watchers) || !Array.isArray(catalog.data!.chains)) return UNKNOWN;
  const reported = Date.parse(r.time);
  if (!Number.isFinite(reported) || now - reported > 90000 || reported > now + 10000) return UNKNOWN;
  if (!catalog.data!.chains.some(c => c.chain === id)) return { label: "Not enabled", tone: "waiting", detail: "This network is not enabled on this deployment." };
  if (r.status !== "ready" || r.canton !== "reachable") return blocked("The Canton connection needed for this staking route is unavailable.");
  const watcher = w.watchers.find(row => row.chain === id);
  const lastScan = Date.parse(watcher?.lastSuccessAt ?? "");
  if (watcher?.status !== "ok" || !Number.isFinite(lastScan) || lastScan > now + 10000 || now - lastScan > 180000)
    return blocked("Staking confirmation checks are currently unavailable.");
  if (r.nativeStaking) {
    const route = r.nativeStaking.find(row => row.chain === id);
    if (!route || route.reason !== null) return blocked("The staking service for this network is currently unavailable.");
  }
  if (externalLoop && (r.loopStaking?.status !== "ready" || !r.loopStaking.supportedChains?.includes(id)))
    return blocked("The Loop staking connection for this network is currently unavailable.");
  return { label: "Available", tone: "ready", detail: "Native validator staking. Reward eligibility is checked separately." };
}

export function poolAvailability(snapshot: StatusSnapshot<{ paused: boolean; available: boolean }>, now = Date.now()): NetworkAvailability {
  if (snapshot.failed || (snapshot.data && !freshSnapshot(snapshot, now))) return UNKNOWN;
  if (!snapshot.data) return CHECKING;
  if (snapshot.data.paused || !snapshot.data.available) return blocked("Pool deposits are currently unavailable. Existing holdings and exits can be managed on the staking page.");
  return { label: "Pool available", tone: "ready", detail: "Pooled staking deposits are available." };
}
