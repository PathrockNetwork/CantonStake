"use client";

import { useQuery } from "@tanstack/react-query";
import {
  fetchAnalyticsMarkers,
  fetchRecentRounds,
  fetchRewardHealth,
} from "@/lib/api";
import { usePrices } from "@/lib/prices";
import { tokens } from "@/lib/tokens";

/**
 * Bloomberg-style auto-scrolling ticker tape. Every entry is wired to
 * a real backend / price-feed source — no static demo numbers.
 *
 *   CC/USD           — env-configured (no public price feed yet)
 *   POL/USD ±24h     — CoinGecko via lib/prices
 *   NETWORK SHARE    — latest round's userTrafficSharePct
 *   ROUND            — /api/rewards/health.lastRound
 *   MARKERS·24H ±    — /api/analytics/markers.insight
 *   CC MINTED·R      — latest round's totalCcMinted
 *   BENEFICIARY      — fixed by the on-ledger split
 *   AMOY / CANTON    — placeholder while latency probes are not wired
 */

type TapeItem = {
  symbol: string;
  price: string;
  delta: string;
  up: boolean | null;
};

function fmtSigned(n: number, suffix = "%"): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}${suffix}`;
}

function shortNumber(n: number, digits = 1): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(digits)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(digits)}K`;
  return n.toFixed(digits);
}

function Row({ items }: { items: TapeItem[] }) {
  return (
    <>
      {items.map((it, i) => (
        <div
          key={`${it.symbol}-${i}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            paddingRight: 32,
          }}
        >
          <span
            className="mono"
            style={{
              fontSize: 10,
              color: tokens.ink[400],
              letterSpacing: ".06em",
            }}
          >
            {it.symbol}
          </span>
          <span
            className="mono tabular"
            style={{ fontSize: 10.5, color: tokens.ink[100], fontWeight: 600 }}
          >
            {it.price}
          </span>
          <span
            className="mono tabular"
            style={{
              fontSize: 10,
              color:
                it.up === true
                  ? tokens.neon
                  : it.up === false
                    ? tokens.danger
                    : tokens.ink[400],
            }}
          >
            {it.up === true ? "▲" : it.up === false ? "▼" : "·"} {it.delta}
          </span>
        </div>
      ))}
    </>
  );
}

export function PriceTape() {
  const { data: prices } = usePrices();
  const { data: rounds } = useQuery({
    queryKey: ["tape-rounds"],
    queryFn: () => fetchRecentRounds(undefined, 2),
    refetchInterval: 30_000,
  });
  const { data: markers } = useQuery({
    queryKey: ["tape-markers"],
    queryFn: () => fetchAnalyticsMarkers(undefined, 24),
    refetchInterval: 60_000,
  });
  const { data: health } = useQuery({
    queryKey: ["tape-health"],
    queryFn: () => fetchRewardHealth(),
    refetchInterval: 60_000,
  });

  const polUsd = prices?.polUsd ?? null;
  const polDelta = prices?.polUsd24hChange ?? null;
  const glmrUsd = prices?.glmrUsd ?? null;
  const monUsd = prices?.monUsd ?? null;
  const atomUsd = prices?.atomUsd ?? null;
  const suiUsd = prices?.suiUsd ?? null;
  const ccUsd = prices?.ccUsd ?? null;

  const latest = rounds?.rounds[0];
  const prior = rounds?.rounds[1];
  const networkShare = latest?.userTrafficSharePct ?? null;
  const networkShareDelta =
    networkShare !== null &&
    prior?.userTrafficSharePct !== null &&
    prior?.userTrafficSharePct !== undefined
      ? networkShare - prior.userTrafficSharePct
      : null;

  const ccMinted = latest ? Number(latest.totalCcMinted) : null;
  const priorCcMinted = prior ? Number(prior.totalCcMinted) : null;
  const ccMintedDelta =
    ccMinted !== null && priorCcMinted !== null && priorCcMinted > 0
      ? ((ccMinted - priorCcMinted) / priorCcMinted) * 100
      : null;

  const items: TapeItem[] = [
    {
      symbol: "CC/USD",
      price: ccUsd !== null ? `$${ccUsd.toFixed(2)}` : "—",
      delta: prices?.source.cc === "env" ? "ENV" : "FALLBACK",
      up: null,
    },
    {
      symbol: "POL/USD",
      price: polUsd !== null ? `$${polUsd.toFixed(3)}` : "—",
      delta: polDelta !== null ? fmtSigned(polDelta) : "—",
      up: polDelta === null ? null : polDelta >= 0,
    },
    {
      symbol: "DEV/USD",
      price: glmrUsd !== null ? `$${glmrUsd.toFixed(3)}` : "—",
      delta: "TESTNET",
      up: null,
    },
    {
      symbol: "MON/USD",
      price: monUsd !== null ? `$${monUsd.toFixed(3)}` : "—",
      delta: "TESTNET",
      up: null,
    },
    {
      symbol: "ATOM/USD",
      price: atomUsd !== null ? `$${atomUsd.toFixed(2)}` : "—",
      delta: "TESTNET",
      up: null,
    },
    {
      symbol: "SUI/USD",
      price: suiUsd !== null ? `$${suiUsd.toFixed(2)}` : "—",
      delta: "TESTNET",
      up: null,
    },
    {
      symbol: "NETWORK SHARE",
      price: networkShare !== null ? `${networkShare.toFixed(2)}%` : "—",
      delta:
        networkShareDelta !== null
          ? fmtSigned(networkShareDelta, "pt")
          : "—",
      up: networkShareDelta === null ? null : networkShareDelta >= 0,
    },
    {
      symbol: "ROUND",
      price:
        health?.lastRound?.roundNumber !== undefined
          ? `#${health.lastRound.roundNumber.toLocaleString()}`
          : "—",
      delta: health?.status === "ok" ? "LIVE" : (health?.status ?? "—").toUpperCase(),
      up: health?.status === "ok" ? true : health?.status === "failing" ? false : null,
    },
    {
      symbol: "MARKERS·24H",
      price:
        markers?.insight.totalMarkers !== undefined
          ? markers.insight.totalMarkers.toLocaleString()
          : "—",
      delta:
        markers?.insight.deltaPct !== null &&
        markers?.insight.deltaPct !== undefined
          ? fmtSigned(markers.insight.deltaPct)
          : "—",
      up:
        markers?.insight.deltaPct === null ||
        markers?.insight.deltaPct === undefined
          ? null
          : markers.insight.deltaPct >= 0,
    },
    {
      symbol: "CC MINTED·R",
      price: ccMinted !== null ? shortNumber(ccMinted, 1) : "—",
      delta: ccMintedDelta !== null ? fmtSigned(ccMintedDelta) : "—",
      up: ccMintedDelta === null ? null : ccMintedDelta >= 0,
    },
    {
      symbol: "BENEFICIARY",
      price: "75/25",
      delta: "ON-LEDGER",
      up: true,
    },
    {
      symbol: "RUN HEALTH",
      price:
        health?.successRatePct !== null && health?.successRatePct !== undefined
          ? `${health.successRatePct.toFixed(1)}%`
          : "—",
      delta:
        health?.totalSampled !== undefined
          ? `last ${health.totalSampled}`
          : "—",
      up: (health?.successRatePct ?? 0) >= 95,
    },
  ];

  return (
    <div
      style={{
        borderTop: `1px solid ${tokens.hairline}`,
        borderBottom: `1px solid ${tokens.hairline}`,
        background: tokens.ink[900],
        overflow: "hidden",
        padding: "6px 0",
      }}
    >
      <div className="ticker">
        <Row items={items} />
        <Row items={items} />
      </div>
    </div>
  );
}
