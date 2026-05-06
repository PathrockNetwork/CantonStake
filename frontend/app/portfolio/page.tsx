"use client";

import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { Btn } from "@/components/primitives/Btn";
import { Card } from "@/components/primitives/Card";
import { Chip } from "@/components/primitives/Chip";
import { EmptyState } from "@/components/primitives/EmptyState";
import { SectionLabel } from "@/components/primitives/SectionLabel";
import { fetchPortfolio, type DelegationRow } from "@/lib/api";
import { CHAINS } from "@/lib/chains";
import { fmt, fmtUsd } from "@/lib/format";
import { tokens } from "@/lib/tokens";

/**
 * Cross-chain portfolio — aggregates delegations across every registered
 * chain adapter via /api/portfolio/:address. One row per (chain,
 * validator) pair; status-aware so unbonding rows show their unlock ETA.
 */

const CHAIN_COLOR: Record<string, string> = Object.fromEntries(
  CHAINS.map((c) => [c.id, c.color]),
);
const CHAIN_NAME: Record<string, string> = Object.fromEntries(
  CHAINS.map((c) => [c.id, c.name]),
);

function shortAddr(addr: string): string {
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-4)}`;
}

function relativeUnlock(unbondingReadyAt?: number): string {
  if (!unbondingReadyAt) return "—";
  const ms = unbondingReadyAt * 1000 - Date.now();
  if (ms <= 0) return "ready to claim";
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  const hours = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  if (days > 0) return `unlocks in ${days}d ${hours}h`;
  return `unlocks in ${hours}h`;
}

function chainDecimals(chain: string): number {
  if (chain === "cosmos") return 6;
  if (chain === "sui") return 9;
  return 18;
}

function formatNative(amount: string, chain: string): string {
  try {
    const value = BigInt(amount);
    const decimals = chainDecimals(chain);
    const scale = BigInt(10) ** BigInt(decimals);
    const whole = value / scale;
    const frac = value % scale;
    const fracStr = frac.toString().padStart(decimals, "0").slice(0, 4);
    return `${whole.toString()}.${fracStr}`;
  } catch {
    return amount;
  }
}

export default function PortfolioPage() {
  const { address, isConnected } = useAccount();

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["portfolio", address],
    queryFn: () => (address ? fetchPortfolio(address) : null),
    enabled: !!address,
    refetchInterval: 30_000,
  });

  if (!isConnected) {
    return (
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "40px 22px 80px" }}>
        <SectionLabel>§ PORTFOLIO</SectionLabel>
        <h1
          className="display"
          style={{ fontSize: 42, margin: "4px 0 24px", color: tokens.ink[100] }}
        >
          Cross-chain portfolio.
        </h1>
        <EmptyState
          tone="warn"
          title="Connect your wallet"
          subtitle="Portfolio aggregates delegations across all registered chain adapters using your EVM address as the lookup key."
        />
      </div>
    );
  }

  const delegations = data?.delegations ?? [];
  const byChain = new Map<string, DelegationRow[]>();
  for (const d of delegations) {
    if (!byChain.has(d.chain)) byChain.set(d.chain, []);
    byChain.get(d.chain)!.push(d);
  }

  const totalUsd = data?.totalUsd ?? 0;
  const bondedCount = delegations.filter((d) => d.status === "bonded").length;
  const unbondingCount = delegations.filter(
    (d) => d.status === "unbonding",
  ).length;

  return (
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: "40px 22px 80px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          marginBottom: 24,
        }}
      >
        <div>
          <SectionLabel>§ PORTFOLIO</SectionLabel>
          <h1
            className="display"
            style={{ fontSize: 42, margin: "4px 0 6px", color: tokens.ink[100] }}
          >
            Cross-chain portfolio.
          </h1>
          <div
            className="mono"
            style={{ fontSize: 11, color: tokens.ink[400] }}
          >
            {data?.fetchedAt
              ? `last refreshed ${new Date(data.fetchedAt).toLocaleTimeString()}`
              : "loading…"}
          </div>
        </div>
        <Btn
          size="sm"
          variant="ghost"
          onClick={() => void refetch()}
          disabled={isFetching}
        >
          {isFetching ? "Refreshing…" : "Refresh"}
        </Btn>
      </div>

      {/* Aggregate stat row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 1,
          background: tokens.hairline,
          marginBottom: 24,
        }}
      >
        <div style={{ background: tokens.ink[900], padding: "22px 22px" }}>
          <SectionLabel>Total value</SectionLabel>
          <div
            className="display tabular"
            style={{ fontSize: 38, color: tokens.ink[100], marginTop: 8 }}
          >
            {fmtUsd(totalUsd, 2)}
          </div>
          <div
            className="mono"
            style={{ fontSize: 10.5, color: tokens.ink[400], marginTop: 8 }}
          >
            across {byChain.size} chain{byChain.size === 1 ? "" : "s"}
          </div>
        </div>
        <div style={{ background: tokens.ink[900], padding: "22px 22px" }}>
          <SectionLabel>Bonded</SectionLabel>
          <div
            className="display tabular"
            style={{ fontSize: 38, color: tokens.neon, marginTop: 8 }}
          >
            {bondedCount}
          </div>
          <div
            className="mono"
            style={{ fontSize: 10.5, color: tokens.ink[400], marginTop: 8 }}
          >
            active delegations
          </div>
        </div>
        <div style={{ background: tokens.ink[900], padding: "22px 22px" }}>
          <SectionLabel>Unbonding</SectionLabel>
          <div
            className="display tabular"
            style={{
              fontSize: 38,
              color: unbondingCount > 0 ? tokens.warning : tokens.ink[100],
              marginTop: 8,
            }}
          >
            {unbondingCount}
          </div>
          <div
            className="mono"
            style={{ fontSize: 10.5, color: tokens.ink[400], marginTop: 8 }}
          >
            cooling down
          </div>
        </div>
      </div>

      {/* Per-chain breakdown */}
      <Card padding={0}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1.4fr 1fr 1fr 0.8fr",
            gap: 12,
            padding: "10px 22px",
            borderBottom: `1px solid ${tokens.hairline}`,
          }}
        >
          {["Chain", "Validator", "Amount", "Status", "Source"].map((h) => (
            <SectionLabel key={h}>{h}</SectionLabel>
          ))}
        </div>

        {isLoading ? (
          <div
            className="mono"
            style={{
              padding: 40,
              textAlign: "center",
              color: tokens.ink[400],
              fontSize: 11,
            }}
          >
            loading delegations…
          </div>
        ) : delegations.length === 0 ? (
          <div style={{ padding: 22 }}>
            <EmptyState
              title="No delegations yet"
              subtitle="Stake on any of the supported chains and your positions will appear here, aggregated in USD."
            />
          </div>
        ) : (
          delegations.map((d, i) => (
            <div
              key={`${d.chain}-${d.validator}-${i}`}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1.4fr 1fr 1fr 0.8fr",
                gap: 12,
                padding: "14px 22px",
                borderBottom: `1px solid ${tokens.hairline}`,
                alignItems: "center",
              }}
            >
              <div
                style={{ display: "flex", alignItems: "center", gap: 8 }}
              >
                <span
                  style={{
                    display: "inline-block",
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: CHAIN_COLOR[d.chain] ?? tokens.ink[400],
                  }}
                />
                <span
                  className="mono"
                  style={{ fontSize: 12, color: tokens.ink[100] }}
                >
                  {CHAIN_NAME[d.chain] ?? d.chain}
                </span>
              </div>
              <div
                className="mono tabular"
                style={{ fontSize: 11, color: tokens.ink[200] }}
              >
                {shortAddr(d.validator)}
              </div>
              <div
                className="mono tabular"
                style={{ fontSize: 12, color: tokens.ink[100] }}
              >
                {fmt(Number(formatNative(d.amount, d.chain)), 4)} {d.symbol}
              </div>
              <div>
                <Chip
                  color={
                    d.status === "bonded"
                      ? tokens.neon
                      : d.status === "unbonding"
                        ? tokens.warning
                        : tokens.ink[400]
                  }
                  dot
                >
                  {d.status === "unbonding"
                    ? relativeUnlock(d.unbondingReadyAt)
                    : d.status.toUpperCase()}
                </Chip>
              </div>
              <div
                className="mono"
                style={{ fontSize: 10, color: tokens.ink[400] }}
              >
                {data?.source[d.chain] ?? "—"}
              </div>
            </div>
          ))
        )}
      </Card>
    </div>
  );
}
