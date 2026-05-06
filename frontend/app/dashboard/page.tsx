"use client";

import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { Btn } from "@/components/primitives/Btn";
import { Card } from "@/components/primitives/Card";
import { Chip } from "@/components/primitives/Chip";
import { EmptyState } from "@/components/primitives/EmptyState";
import { SectionLabel } from "@/components/primitives/SectionLabel";
import { StatusDot } from "@/components/primitives/StatusDot";
import { IconExternal } from "@/components/icons";
import {
  fetchPositions,
  fetchRecentRounds,
  fetchRewards,
  type PositionRow,
} from "@/lib/api";
import { fmt, fmtUsd } from "@/lib/format";
import { useCantonWallet, useLoopHoldings } from "@/lib/canton";
import { usePrices } from "@/lib/prices";
import { tokens } from "@/lib/tokens";

/**
 * Dashboard — ported from handoff/prototype/redesign/screens.jsx (`Dashboard`).
 *
 * Stat row + last-CC-round + positions table, wired to real
 * `fetchPositions` + `fetchRewards`. The "ourMarkers" / "ourShare" /
 * "mintedCC" numbers in the Last Round card are derived from totals
 * since no per-round endpoint exists yet (PORT_GUIDE §Step 7).
 */

function shortContract(id: string): string {
  if (id.length <= 18) return id;
  return `${id.slice(0, 12)}...${id.slice(-4)}`;
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function relativeTime(iso?: string): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`;
  return `${Math.floor(ms / 86_400_000)}d`;
}

export default function DashboardPage() {
  const { address, isConnected } = useAccount();
  const { partyId } = useCantonWallet();
  const { ccBalance } = useLoopHoldings();
  const { data: prices } = usePrices();
  const polPriceUsd = prices?.polUsd ?? 0;
  const ccPriceUsd = prices?.ccUsd ?? 0;

  const positionsQ = useQuery({
    queryKey: ["dashboard-positions", address],
    queryFn: () => (address ? fetchPositions(address) : Promise.resolve([])),
    enabled: !!address,
    refetchInterval: 10_000,
  });
  const rewardsQ = useQuery({
    queryKey: ["dashboard-rewards", address],
    queryFn: () => (address ? fetchRewards(address) : null),
    enabled: !!address,
    refetchInterval: 10_000,
  });
  const roundsQ = useQuery({
    queryKey: ["dashboard-rounds", address],
    queryFn: () => fetchRecentRounds(address ?? undefined, 1),
    enabled: !!address,
    refetchInterval: 10_000,
  });

  if (!isConnected) {
    return (
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "40px 22px 80px" }}>
        <SectionLabel>§ DASHBOARD</SectionLabel>
        <h1
          className="display"
          style={{ fontSize: 42, margin: "4px 0 24px", color: tokens.ink[100] }}
        >
          Live staking dashboard.
        </h1>
        <EmptyState
          tone="warn"
          title="Connect your wallet"
          subtitle="Dashboard data is scoped to your EVM + Loop identities. Connect both to see your live staking activity."
        />
      </div>
    );
  }

  const positions = (positionsQ.data ?? []).filter(
    (p) => p.argument.status !== "Released" && p.argument.status !== "Cancelled",
  );
  const rewards = rewardsQ.data;
  const totalBondedPol = rewards?.totalBondedPol ?? 0;
  const totalCc = rewards?.totalUserShare ?? 0;
  const rewardEvents = Math.max(1, rewards?.rewardEventCount ?? 0);
  const ccPerDay = ((rewards?.totalUserShare ?? 0) / rewardEvents) * 144;
  const ccPerDayUsd = ccPerDay * ccPriceUsd;
  const nativePerDay =
    ((rewards?.totalUserPayoutPol ?? 0) /
      Math.max(1, rewards?.rewardSweepCount ?? 0)) *
    144;
  const nativePerDayUsd = nativePerDay * polPriceUsd;

  // Blended APY = native staking yield + CC bonus, computed from this user's
  // observed flows. Falls back to "—" until enough data has accrued (one full
  // sweep + reward event).
  const stakedUsd = totalBondedPol * polPriceUsd;
  const nativeApy = stakedUsd > 0 ? (nativePerDayUsd * 365) / stakedUsd : 0;
  const ccApy = stakedUsd > 0 ? (ccPerDayUsd * 365) / stakedUsd : 0;
  const blendedApy = nativeApy + ccApy;
  const hasYield = stakedUsd > 0 && (rewards?.rewardSweepCount ?? 0) > 0;

  const stats = [
    {
      label: "Total Staked",
      value: fmtUsd(stakedUsd, 2),
      sub: `+ ${positions.length} positions · POL ${fmt(totalBondedPol, 2)}`,
      accent: tokens.ink[100],
    },
    {
      label: ccBalance !== null ? "CC balance · Loop" : "CC earned",
      value: ccBalance !== null ? fmt(ccBalance, 1) : fmt(totalCc, 1),
      unit: "CC",
      sub:
        ccBalance !== null
          ? `wallet · ≈ ${fmtUsd(ccBalance * ccPriceUsd)} · CC/USD $${ccPriceUsd.toFixed(2)}`
          : `≈ ${fmtUsd(totalCc * ccPriceUsd)} · CC/USD $${ccPriceUsd.toFixed(2)}`,
      accent: tokens.cc,
    },
    {
      label: "24h rewards",
      value: fmtUsd(ccPerDayUsd + nativePerDayUsd, 2),
      sub: `● ${fmt(ccPerDay, 2)} CC  ● ${fmtUsd(nativePerDayUsd, 2)} native`,
      accent: tokens.ink[100],
    },
    {
      label: "Blended APY",
      value: hasYield ? `${(blendedApy * 100).toFixed(1)}%` : "—",
      sub: hasYield
        ? `${(nativeApy * 100).toFixed(1)}% native + ${(ccApy * 100).toFixed(1)}% CC bonus`
        : "needs ≥1 sweep + reward event",
      accent: tokens.neon,
    },
  ];

  // "Last CC round" summary — pulled from /api/rewards/rounds
  const latestRound = roundsQ.data?.rounds[0];
  const ourShare = latestRound?.userTrafficSharePct ?? null;
  const lastRound = latestRound
    ? {
        id: latestRound.roundNumber,
        minted: Number(latestRound.totalCcMinted),
        ourMarkers: positions.reduce((s, p) => s + p.argument.markersEmitted, 0),
        ourShare: ourShare ?? 0,
        yourCc: Number(latestRound.userCcAttributed ?? "0") * 0.75,
      }
    : null;

  return (
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: "40px 22px 80px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          marginBottom: 32,
        }}
      >
        <div>
          <div
            className="mono"
            style={{
              fontSize: 10.5,
              letterSpacing: ".18em",
              color: tokens.ink[400],
              textTransform: "uppercase",
              marginBottom: 6,
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <StatusDot /> FEATURED APP · NETWORK SHARE{" "}
            {ourShare !== null ? `${ourShare.toFixed(2)}%` : "—"}
          </div>
          <h1
            className="display"
            style={{ fontSize: 48, margin: "0 0 6px", color: tokens.ink[100] }}
          >
            Live staking dashboard.
          </h1>
          <div className="mono" style={{ fontSize: 11, color: tokens.ink[400] }}>
            Loop party {partyId ? `${partyId.slice(0, 16)}...` : "—"} · EVM wallet{" "}
            {address ? shortAddr(address) : "—"} · Self-custody · keys never
            leave your wallet
          </div>
        </div>
      </div>

      {/* Stat row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4,1fr)",
          gap: 1,
          background: tokens.hairline,
          marginBottom: 24,
        }}
      >
        {stats.map((s) => (
          <div
            key={s.label}
            style={{ background: tokens.ink[900], padding: "22px 22px 24px" }}
          >
            <SectionLabel>{s.label}</SectionLabel>
            <div
              className="display tabular"
              style={{
                fontSize: 38,
                color: s.accent,
                marginTop: 8,
                lineHeight: 1,
              }}
            >
              {s.value}
              {s.unit && (
                <span
                  className="mono"
                  style={{ fontSize: 13, color: tokens.ink[400], marginLeft: 8 }}
                >
                  {s.unit}
                </span>
              )}
            </div>
            <div
              className="mono"
              style={{ fontSize: 10.5, color: tokens.ink[400], marginTop: 10 }}
            >
              {s.sub}
            </div>
          </div>
        ))}
      </div>

      {/* Last CC round summary */}
      {lastRound ? (
        <Card
          padding={0}
          style={{ marginBottom: 24, position: "relative", overflow: "hidden" }}
        >
          <div
            style={{
              padding: "18px 22px",
              borderBottom: `1px solid ${tokens.hairline}`,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div>
              <SectionLabel>
                § Last CC round · #{lastRound.id.toLocaleString()}
              </SectionLabel>
              <div
                className="display"
                style={{ fontSize: 22, color: tokens.ink[100], marginTop: 2 }}
              >
                {latestRound?.relativeTime ?? "Round closed recently."}
              </div>
            </div>
            <Chip color={tokens.cc} dot>
              {latestRound?.status === "completed" ? "MINTED" : (latestRound?.status ?? "—").toUpperCase()}
            </Chip>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4,1fr)",
              gap: 1,
              background: tokens.hairline,
            }}
          >
            {[
              {
                l: "CC minted (round)",
                v: `${fmt(lastRound.minted, 1)} CC`,
                a: tokens.cc,
              },
              { l: "Our markers", v: lastRound.ourMarkers, a: tokens.neon },
              {
                l: "Our share",
                v:
                  ourShare !== null
                    ? `${ourShare.toFixed(2)}%`
                    : "—",
                a: tokens.ink[100],
              },
              {
                l: "Your CC (75%)",
                v: `+ ${fmt(lastRound.yourCc, 2)}`,
                a: tokens.cc,
              },
            ].map((s) => (
              <div
                key={s.l}
                style={{ padding: "16px 22px", background: tokens.ink[900] }}
              >
                <SectionLabel>{s.l}</SectionLabel>
                <div
                  className="display tabular"
                  style={{ fontSize: 22, color: s.a, marginTop: 4 }}
                >
                  {s.v}
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {/* Positions table */}
      <Card padding={0}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "16px 22px",
            borderBottom: `1px solid ${tokens.hairline}`,
          }}
        >
          <div>
            <div className="display" style={{ fontSize: 22, color: tokens.ink[100] }}>
              Active positions
            </div>
            <div
              className="mono"
              style={{ fontSize: 10.5, color: tokens.ink[400], marginTop: 2 }}
            >
              {positions.length} live position{positions.length === 1 ? "" : "s"} ·
              Polygon Amoy
            </div>
          </div>
          <Btn href="/stake" icon={<span style={{ fontSize: 14 }}>+</span>}>
            Stake new
          </Btn>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.4fr 1fr .8fr 1fr 1fr 1fr",
            gap: 12,
            padding: "10px 22px",
            borderBottom: `1px solid ${tokens.hairline}`,
          }}
        >
          {[
            "Contract id · validator",
            "Staked",
            "Lifecycle",
            "Markers",
            "Bonded",
            "Status",
          ].map((h) => (
            <SectionLabel key={h}>{h}</SectionLabel>
          ))}
        </div>
        {positionsQ.isLoading ? (
          <div
            className="mono"
            style={{
              padding: "40px 22px",
              color: tokens.ink[400],
              textAlign: "center",
            }}
          >
            loading positions…
          </div>
        ) : positions.length === 0 ? (
          <div style={{ padding: 22 }}>
            <EmptyState
              title="No active positions"
              subtitle="Open the staking console to bond your first POL position."
            />
          </div>
        ) : (
          positions.map((p) => <DashRow key={p.contractId} p={p} />)
        )}
      </Card>
    </div>
  );
}

function DashRow({ p }: { p: PositionRow }) {
  const isBonded = p.argument.status === "Bonded";
  const lifecycleColor = isBonded ? tokens.neon : tokens.warning;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1.4fr 1fr .8fr 1fr 1fr 1fr",
        gap: 12,
        padding: "16px 22px",
        borderBottom: `1px solid ${tokens.hairline}`,
        alignItems: "center",
      }}
    >
      <div>
        <div className="mono tabular" style={{ fontSize: 12, color: tokens.ink[100] }}>
          {shortContract(p.contractId)}
        </div>
        <div
          className="mono"
          style={{ fontSize: 10.5, color: tokens.ink[400], marginTop: 2 }}
        >
          MockValidatorShare · {relativeTime(p.argument.bondedAt)}
        </div>
      </div>
      <div className="mono tabular" style={{ fontSize: 14, color: tokens.ink[100] }}>
        {fmt(parseFloat(p.argument.amountPol), 2)}{" "}
        <span style={{ color: tokens.ink[400], fontSize: 10 }}>POL</span>
      </div>
      <Chip color={lifecycleColor} dot>
        {p.argument.status.toLowerCase()}
      </Chip>
      <div className="mono tabular" style={{ fontSize: 12, color: tokens.cc }}>
        {p.argument.markersEmitted}
      </div>
      <div className="mono" style={{ fontSize: 11, color: tokens.ink[300] }}>
        {relativeTime(p.argument.bondedAt)} ago
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span className="mono" style={{ fontSize: 10.5, color: tokens.ink[300] }}>
          on-ledger
        </span>
        <IconExternal size={11} color={tokens.ink[400]} />
      </div>
    </div>
  );
}
