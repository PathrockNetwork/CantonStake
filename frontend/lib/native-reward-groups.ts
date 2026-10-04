import type { RewardHistoryEvent } from "./api";

export function recordedRewardTotal(events: Pick<RewardHistoryEvent, "amount">[]): number | undefined {
  let total = 0;
  for (const event of events) {
    const amount = /^\d+(?:\.\d+)?$/.test(event.amount) ? Number(event.amount) : NaN;
    if (!Number.isFinite(amount) || !Number.isFinite(total + amount)) return undefined;
    total += amount;
  }
  return total;
}

/** A stake balance is not an earned payout. Group only recorded native
 * events, keeping networks and currencies separate rather than assuming POL. */
export function nativeRewardGroups(history: RewardHistoryEvent[]) {
  const groups = new Map<string, { key: string; chain: string; symbol: string; events: RewardHistoryEvent[] }>();
  for (const event of history) {
    if (event.kind !== "native") continue;
    const key = JSON.stringify([event.chain, event.symbol]);
    let group = groups.get(key);
    if (!group) {
      group = { key, chain: event.chain, symbol: event.symbol, events: [] };
      groups.set(key, group);
    }
    group.events.push(event);
  }
  return [...groups.values()].map(group => ({ ...group, total: recordedRewardTotal(group.events) }));
}
