"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchRewardHealth } from "./api";

export function useProtocolStatus() {
  const query = useQuery({
    queryKey: ["protocol-health"],
    queryFn: fetchRewardHealth,
    staleTime: 20_000,
    refetchInterval: 30_000,
    retry: 1,
  });
  const health = query.data;
  const stale = !!health?.lastRound?.completedAt
    && Date.now() - new Date(health.lastRound.completedAt).getTime() > 20 * 60_000;
  const label = query.isError ? "Unavailable" : !health ? "Connecting"
    : stale ? "Delayed" : health.status === "ok" ? "Live"
    : health.status === "idle" ? "Awaiting activity" : "Attention needed";
  return { ...query, health, label, live: label === "Live" };
}
