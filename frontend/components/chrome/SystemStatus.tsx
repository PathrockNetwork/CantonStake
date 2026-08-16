"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchChainStats, fetchWatcherStatus, type ChainStat } from "@/lib/api";
import { CHAINS } from "@/lib/chains";
import { networkMode } from "@/lib/network";
import { tokens } from "@/lib/tokens";

const CHAIN_LABEL: Record<string, string> = Object.fromEntries(
  CHAINS.map((c) => [c.id, c.name]),
);
const CHAIN_COLOR: Record<string, string> = Object.fromEntries(
  CHAINS.map((c) => [c.id, c.color]),
);

function statusFor(stat: ChainStat | undefined): {
  label: string;
  color: string;
} {
  if (!stat) return { label: "● —", color: tokens.ink[400] };
  if (stat.source === "live")
    return { label: `● LIVE · ${stat.validatorCount} val`, color: tokens.neon };
  if (stat.source === "cache")
    return {
      label: `● CACHE · ${stat.validatorCount} val`,
      color: tokens.cc,
    };
  return { label: "○ STUB", color: tokens.amberBright };
}

export function SystemStatus() {
  // The backend is the source of truth for the deployment's network mode
  // (it is what settles); the build-time frontend value is the fallback.
  const { data: watchers } = useQuery({
    queryKey: ["watcher-status"],
    queryFn: fetchWatcherStatus,
    refetchInterval: 60_000,
  });
  const backendMode = watchers?.networkMode;

  const { data } = useQuery({
    queryKey: ["chain-stats-system-status"],
    queryFn: () => fetchChainStats(),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const byChain = new Map<string, ChainStat>();
  for (const c of data?.chains ?? []) byChain.set(c.chain, c);

  // Layout: one row per supported chain + a Canton row at the top
  const chains = [
    "polygon",
    "monad",
    "cosmos",
    "celestia",
    "osmosis",
    "sui",
    "aptos",
    "polkadot",
    "bnb",
    "solana",
  ] as const;

  return (
    <div
      style={{
        padding: "18px 20px",
        background: tokens.ink[900],
        border: `1px solid ${tokens.hairline}`,
      }}
    >
      <div
        className="mono"
        style={{
          fontSize: 10,
          letterSpacing: ".1em",
          color: tokens.ink[400],
          textTransform: "uppercase",
          marginBottom: 12,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        System status
        <span
          className="mono"
          style={{
            fontSize: 9,
            padding: "2px 6px",
            border: `1px solid ${backendMode === "mainnet" ? "rgba(239,68,68,.5)" : tokens.hairline}`,
            color: backendMode === "mainnet" ? "#ef4444" : tokens.ink[300],
            textTransform: "uppercase",
          }}
        >
          {backendMode ?? networkMode} net
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto",
          gap: "8px 16px",
          fontSize: 11,
        }}
      >
        <span className="mono" style={{ color: tokens.ink[300] }}>
          Canton participant
        </span>
        <span className="mono" style={{ color: tokens.neon }}>
          ● OK
        </span>

        {chains.map((id) => {
          const stat = byChain.get(id);
          const status = statusFor(stat);
          const apy = stat?.apyPctEstimate;
          return (
            <ChainRow
              key={id}
              id={id}
              label={CHAIN_LABEL[id] ?? id}
              dotColor={CHAIN_COLOR[id] ?? tokens.ink[400]}
              status={status}
              apy={apy}
            />
          );
        })}
      </div>
    </div>
  );
}

function ChainRow({
  id,
  label,
  dotColor,
  status,
  apy,
}: {
  id: string;
  label: string;
  dotColor: string;
  status: { label: string; color: string };
  apy: number | undefined;
}) {
  return (
    <>
      <span
        className="mono"
        style={{
          color: tokens.ink[300],
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span
          style={{
            display: "inline-block",
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: dotColor,
          }}
        />
        {label}
        {apy !== undefined && apy > 0 ? (
          <span style={{ color: tokens.ink[500], fontSize: 10 }}>
            · {apy.toFixed(1)}% apy
          </span>
        ) : null}
        <span
          className="mono"
          style={{
            fontSize: 9,
            color: tokens.ink[500],
            letterSpacing: ".08em",
            textTransform: "uppercase",
            marginLeft: 4,
          }}
        >
          [{id}]
        </span>
      </span>
      <span className="mono tabular" style={{ color: status.color }}>
        {status.label}
      </span>
    </>
  );
}
