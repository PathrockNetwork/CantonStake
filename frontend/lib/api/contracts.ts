// Codex: needs Claude Code backend impl - GET /api/rewards/events?party=...&limit=20
export type RewardEventRow = {
  round: number;
  ts: string; // ISO
  ccUser: number;
  ccTreasury: number;
  txns?: number;
};

export type RecentRewardEventsResponse = { events: RewardEventRow[] };
