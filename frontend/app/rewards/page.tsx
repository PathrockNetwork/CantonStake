"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { BeneficiaryPipeline } from "@/components/diagrams/BeneficiaryPipeline";
import { Card } from "@/components/primitives/Card";
import { EmptyState } from "@/components/primitives/EmptyState";
import { SectionLabel } from "@/components/primitives/SectionLabel";
import { fetchRewards } from "@/lib/api";
import { fmt, fmtUsd } from "@/lib/format";
import { tokens } from "@/lib/tokens";

/**
 * Rewards — ported from handoff/prototype/redesign/screens.jsx (`Rewards`).
 *
 * Wires the 3-stat row + beneficiary pipeline to real
 * `fetchRewards(address)`. The recent-rounds table is synthesised — no
 * per-round endpoint exists today (PORT_GUIDE §Step 7 leaves it as a
 * `// TODO(api)` to wire when /v1/rewards/rounds ships).
 */

const CC_PRICE_USD = 0.16;

type Round = {
  id: number;
  time: string;
  markers: number;
  cc: string;
  share: string;
};

function synthRounds(count: number, totalCC: number, ourShare: number): Round[] {
  // Small reproducible variation around the user's average. Demo only.
  const baseId = 2_873_541;
  return Array.from({ length: count }, (_, i) => ({
    id: baseId - i,
    time: `${i * 10} min ago`,
    markers: 5 + ((i * 3) % 8),
    cc: ((totalCC || 200) * (0.85 + (i % 5) * 0.06)).toFixed(1),
    share: (ourShare + ((i % 4) - 2) * 0.05).toFixed(2),
  }));
}

export default function RewardsPage() {
  const { address, isConnected } = useAccount();
  const { data: rewards } = useQuery({
    queryKey: ["rewards", address],
    queryFn: () => (address ? fetchRewards(address) : null),
    enabled: !!address,
    refetchInterval: 10_000,
  });

  const userCc = rewards?.totalUserShare ?? 0;
  const treasuryCc = rewards?.totalTreasuryShare ?? 0;
  const totalCc = userCc + treasuryCc;
  const markers24h = rewards?.totalMarkersEmitted ?? 0;
  const networkShare = 2.41; // No real data source yet
  const rounds = useMemo(
    () => synthRounds(10, totalCc / Math.max(1, rewards?.rewardEventCount ?? 1), networkShare),
    [totalCc, rewards?.rewardEventCount],
  );

  return (
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: "40px 22px 80px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          marginBottom: 14,
        }}
      >
        <div>
          <SectionLabel>§ REWARDS · CIP-47</SectionLabel>
          <h1
            className="display"
            style={{ fontSize: 42, margin: "4px 0 8px", color: tokens.ink[100] }}
          >
            Markers → Coupons → CC.
          </h1>
          <p
            style={{
              fontSize: 14,
              lineHeight: 1.6,
              color: tokens.ink[300],
              maxWidth: 680,
              margin: 0,
            }}
          >
            Canton activity markers are converted into reward coupons, then
            into Canton Coin during the 10-minute mint cycle.
          </p>
        </div>
      </div>

      {!isConnected ? (
        <div style={{ marginTop: 24 }}>
          <EmptyState
            tone="cc"
            title="Connect your wallet"
            subtitle="Reward attribution is scoped to your party. Connect both Loop and EVM to see your CC stream."
          />
        </div>
      ) : (
        <>
          {/* Stat row */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 1,
              background: tokens.hairline,
              marginBottom: 24,
            }}
          >
            <div style={{ background: tokens.ink[900], padding: 22 }}>
              <SectionLabel>Markers · 24h</SectionLabel>
              <div
                className="display tabular"
                style={{ fontSize: 42, color: tokens.neon, marginTop: 6 }}
              >
                {fmt(markers24h, 0)}
              </div>
              <div
                className="mono"
                style={{ fontSize: 10.5, color: tokens.ink[400], marginTop: 6 }}
              >
                on-ledger Featured App attestations
              </div>
            </div>
            <div style={{ background: tokens.ink[900], padding: 22 }}>
              <SectionLabel>CC earned</SectionLabel>
              <div
                className="display tabular"
                style={{ fontSize: 42, color: tokens.cc, marginTop: 6 }}
              >
                {fmt(userCc, 1)}
              </div>
              <div
                className="mono"
                style={{ fontSize: 10.5, color: tokens.ink[400], marginTop: 6 }}
              >
                ≈ {fmtUsd(userCc * CC_PRICE_USD)} · CC/USD ${CC_PRICE_USD}
              </div>
            </div>
            <div style={{ background: tokens.ink[900], padding: 22 }}>
              <SectionLabel>App network share</SectionLabel>
              <div
                className="display tabular"
                style={{ fontSize: 42, color: tokens.ink[100], marginTop: 6 }}
              >
                {networkShare.toFixed(2)}%
              </div>
              <div
                className="mono"
                style={{ fontSize: 10.5, color: tokens.ink[400], marginTop: 6 }}
              >
                of all featured app activity
              </div>
            </div>
          </div>

          {/* Beneficiary pipeline */}
          <SectionLabel style={{ marginBottom: 8 }}>
            § Beneficiary split · on-ledger
          </SectionLabel>
          <BeneficiaryPipeline userCc={userCc} treasuryCc={treasuryCc} />

          {/* Slot for the A1 Narrator (filled by Claude track) */}
          {/* slot: A1 Narrator */}

          {/* Formula */}
          <Card style={{ marginTop: 24 }}>
            <SectionLabel>§ How CC is calculated</SectionLabel>
            <div
              className="display"
              style={{
                fontSize: 22,
                color: tokens.ink[100],
                marginTop: 8,
                lineHeight: 1.4,
              }}
            >
              <span style={{ color: tokens.cc }}>round mint</span>
              <span style={{ margin: "0 12px", color: tokens.ink[400] }}>×</span>
              <span style={{ color: tokens.neon }}>app network share</span>
              <span style={{ margin: "0 12px", color: tokens.ink[400] }}>×</span>
              <span style={{ color: tokens.ink[200] }}>beneficiary weight</span>
              <span style={{ margin: "0 12px", color: tokens.ink[400] }}>=</span>
              <span style={{ color: tokens.cc }}>your CC</span>
            </div>
            <div
              className="mono"
              style={{
                fontSize: 11,
                color: tokens.ink[400],
                marginTop: 14,
                lineHeight: 1.7,
                maxWidth: 780,
              }}
            >
              Each round, the Super Validator sums every featured app&rsquo;s
              marker weights, mints CC proportionally, and the in-contract{" "}
              <span style={{ color: tokens.neon }}>BeneficiaryConfig</span>{" "}
              routes 75% to your Loop party and 25% to the app treasury. The
              app does not collect user rewards before distribution — the split
              is encoded on-ledger.
            </div>
          </Card>

          <SectionLabel style={{ margin: "32px 0 8px" }}>
            § Recent rounds
          </SectionLabel>
          <Card padding={0}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr",
                padding: "10px 22px",
                borderBottom: `1px solid ${tokens.hairline}`,
                gap: 12,
              }}
            >
              {["Round", "Time", "Markers", "CC minted", "App share"].map((h) => (
                <SectionLabel key={h}>{h}</SectionLabel>
              ))}
            </div>
            {rounds.map((r) => (
              <div
                key={r.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr",
                  padding: "12px 22px",
                  borderBottom: `1px solid ${tokens.hairline}`,
                  gap: 12,
                  alignItems: "center",
                }}
              >
                <div
                  className="mono tabular"
                  style={{ fontSize: 11.5, color: tokens.ink[100] }}
                >
                  #{r.id.toLocaleString()}
                </div>
                <div className="mono" style={{ fontSize: 11, color: tokens.ink[400] }}>
                  {r.time}
                </div>
                <div
                  className="mono tabular"
                  style={{ fontSize: 12, color: tokens.ink[200] }}
                >
                  {r.markers}
                </div>
                <div
                  className="mono tabular"
                  style={{ fontSize: 12, color: tokens.cc }}
                >
                  {r.cc}
                </div>
                <div
                  className="mono tabular"
                  style={{ fontSize: 12, color: tokens.neon }}
                >
                  {r.share}%
                </div>
              </div>
            ))}
          </Card>
        </>
      )}
    </div>
  );
}
