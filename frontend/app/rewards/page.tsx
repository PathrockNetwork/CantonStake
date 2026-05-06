"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { BeneficiaryPipeline } from "@/components/diagrams/BeneficiaryPipeline";
import { Narrator } from "@/components/diagrams/Narrator";
import { RoundVisualizer } from "@/components/diagrams/RoundVisualizer";
import { Card } from "@/components/primitives/Card";
import { EmptyState } from "@/components/primitives/EmptyState";
import { SectionLabel } from "@/components/primitives/SectionLabel";
import { fetchRewards, fetchRecentRounds, type RoundSummary } from "@/lib/api";
import { fmt, fmtUsd } from "@/lib/format";
import { usePrices } from "@/lib/prices";
import { tokens } from "@/lib/tokens";

/**
 * Rewards — ported from handoff/prototype/redesign/screens.jsx (`Rewards`).
 *
 * Stat row + beneficiary pipeline + recent-rounds table, all wired to real
 * backend endpoints (`fetchRewards`, `fetchRecentRounds`). The "App network
 * share" is taken from the latest round's traffic share (CIP-0104).
 */

export default function RewardsPage() {
  const { address, isConnected } = useAccount();
  const { data: prices } = usePrices();
  const ccPriceUsd = prices?.ccUsd ?? 0;

  const { data: rewards } = useQuery({
    queryKey: ["rewards", address],
    queryFn: () => (address ? fetchRewards(address) : null),
    enabled: !!address,
    refetchInterval: 10_000,
  });

  const { data: roundsResp } = useQuery({
    queryKey: ["rewards-rounds", address],
    queryFn: () => fetchRecentRounds(address ?? undefined, 10),
    enabled: !!address,
    refetchInterval: 10_000,
  });
  const rounds: RoundSummary[] = useMemo(
    () => roundsResp?.rounds ?? [],
    [roundsResp],
  );

  const userCc = rewards?.totalUserShare ?? 0;
  const treasuryCc = rewards?.totalTreasuryShare ?? 0;
  const totalCc = userCc + treasuryCc;
  const markers24h = rewards?.totalMarkersEmitted ?? 0;
  const latestShare = rounds[0]?.userTrafficSharePct;
  const networkShare =
    typeof latestShare === "number" ? latestShare : null;

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
          {/* Live round visualizer — demo climax */}
          <RoundVisualizer
            userCc={userCc}
            treasuryCc={treasuryCc}
            rewardEventCount={rewards?.rewardEventCount ?? 0}
          />

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
                ≈ {fmtUsd(userCc * ccPriceUsd)} · CC/USD ${ccPriceUsd.toFixed(2)}
              </div>
            </div>
            <div style={{ background: tokens.ink[900], padding: 22 }}>
              <SectionLabel>App network share</SectionLabel>
              <div
                className="display tabular"
                style={{ fontSize: 42, color: tokens.ink[100], marginTop: 6 }}
              >
                {networkShare !== null ? `${networkShare.toFixed(2)}%` : "—"}
              </div>
              <div
                className="mono"
                style={{ fontSize: 10.5, color: tokens.ink[400], marginTop: 6 }}
              >
                {networkShare !== null
                  ? "of all featured app activity"
                  : "awaiting first attributed round"}
              </div>
            </div>
          </div>

          {/* Beneficiary pipeline */}
          <SectionLabel style={{ marginBottom: 8 }}>
            § Beneficiary split · on-ledger
          </SectionLabel>
          <BeneficiaryPipeline userCc={userCc} treasuryCc={treasuryCc} />

          {/* A1 Narrator: Anthropic-powered live commentary on the current round. */}
          <Narrator address={address} />

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
            {rounds.length === 0 ? (
              <div
                className="mono"
                style={{
                  padding: "20px 22px",
                  fontSize: 11,
                  color: tokens.ink[400],
                }}
              >
                No completed rounds yet.
              </div>
            ) : (
              rounds.map((r) => (
                <div
                  key={r.roundNumber}
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
                    #{r.roundNumber.toLocaleString()}
                  </div>
                  <div
                    className="mono"
                    style={{ fontSize: 11, color: tokens.ink[400] }}
                  >
                    {r.relativeTime}
                  </div>
                  <div
                    className="mono tabular"
                    style={{ fontSize: 12, color: tokens.ink[200] }}
                  >
                    {r.totalMarkers ?? 0}
                  </div>
                  <div
                    className="mono tabular"
                    style={{ fontSize: 12, color: tokens.cc }}
                  >
                    {fmt(Number(r.totalCcMinted ?? 0), 1)}
                  </div>
                  <div
                    className="mono tabular"
                    style={{ fontSize: 12, color: tokens.neon }}
                  >
                    {r.userTrafficSharePct !== null
                      ? `${r.userTrafficSharePct.toFixed(2)}%`
                      : "—"}
                  </div>
                </div>
              ))
            )}
          </Card>
        </>
      )}
    </div>
  );
}
