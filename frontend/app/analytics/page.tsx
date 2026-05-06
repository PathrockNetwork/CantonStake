"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { Card } from "@/components/primitives/Card";
import { Chip } from "@/components/primitives/Chip";
import { SectionLabel } from "@/components/primitives/SectionLabel";
import { fetchAnalyticsMarkers, fetchRewardHealth } from "@/lib/api";
import { tokens } from "@/lib/tokens";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4001";

const CHART_HOURS = 24;

/**
 * Analytics — marker emissions chart wired to /api/analytics/markers,
 * which buckets RewardEvent rows by hour over the requested window.
 */
export default function AnalyticsPage() {
  const { address, isConnected } = useAccount();
  const csvHref =
    isConnected && address
      ? `${BACKEND_URL}/api/tax/csv?address=${address}&format=koinly`
      : null;

  const markersQ = useQuery({
    queryKey: ["analytics-markers", address ?? "global", CHART_HOURS],
    queryFn: () => fetchAnalyticsMarkers(address ?? undefined, CHART_HOURS),
    refetchInterval: 30_000,
  });
  const healthQ = useQuery({
    queryKey: ["reward-health"],
    queryFn: () => fetchRewardHealth(),
    refetchInterval: 60_000,
  });

  const series = useMemo(
    () => markersQ.data?.series.map((b) => b.markers) ?? [],
    [markersQ.data],
  );
  const maxMarkers = Math.max(1, ...series);
  const pts = series.length > 1
    ? series
        .map(
          (v, i) =>
            `${(i / (series.length - 1)) * 100},${100 - (v / maxMarkers) * 90}`,
        )
        .join(" ")
    : "";

  const totalMarkers = series.reduce((s, v) => s + v, 0);
  const scopeLabel = markersQ.data?.scope === "user" ? "your activity" : "global";

  return (
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: "40px 22px 80px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 24,
        }}
      >
        <div>
          <SectionLabel>§ ANALYTICS</SectionLabel>
          <h1
            className="display"
            style={{ fontSize: 42, margin: "4px 0 12px", color: tokens.ink[100] }}
          >
            Marker activity over time.
          </h1>
        </div>
        {csvHref ? (
          <a
            href={csvHref}
            className="mono"
            download
            style={{
              alignSelf: "center",
              textTransform: "uppercase",
              letterSpacing: 0.6,
              fontSize: 11,
              padding: "10px 14px",
              border: `1px solid ${tokens.hairline}`,
              borderRadius: 6,
              color: tokens.ink[200],
              textDecoration: "none",
            }}
          >
            ↓ Tax CSV (Koinly)
          </a>
        ) : (
          <span
            className="mono"
            style={{
              alignSelf: "center",
              fontSize: 10,
              color: tokens.ink[400],
              maxWidth: 220,
              textAlign: "right",
            }}
          >
            Connect a wallet to download tax CSV
          </span>
        )}
      </div>
      <p
        style={{
          fontSize: 14,
          lineHeight: 1.6,
          color: tokens.ink[300],
          maxWidth: 680,
          margin: "0 0 28px",
        }}
      >
        Live view of marker emissions, reward activity, and system health
        across recent CC rounds.
      </p>

      <Card padding={0}>
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
            <div className="display" style={{ fontSize: 22, color: tokens.ink[100] }}>
              Marker emissions · last {CHART_HOURS}h
            </div>
            <div
              className="mono"
              style={{ fontSize: 10.5, color: tokens.ink[400], marginTop: 2 }}
            >
              {totalMarkers} markers · {scopeLabel}
            </div>
          </div>
          <Chip color={totalMarkers > 0 ? tokens.neon : tokens.ink[400]} dot>
            {markersQ.isLoading ? "LOADING" : totalMarkers > 0 ? "LIVE" : "IDLE"}
          </Chip>
        </div>
        <div style={{ padding: "24px 22px" }}>
          {pts ? (
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              style={{ width: "100%", height: 240 }}
              aria-hidden="true"
            >
              <defs>
                <linearGradient id="aG" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor={tokens.neon} stopOpacity=".4" />
                  <stop offset="1" stopColor={tokens.neon} stopOpacity="0" />
                </linearGradient>
              </defs>
              <polyline
                points={pts}
                fill="none"
                stroke={tokens.neon}
                strokeWidth=".6"
                vectorEffect="non-scaling-stroke"
              />
              <polygon points={`0,100 ${pts} 100,100`} fill="url(#aG)" />
            </svg>
          ) : (
            <div
              className="mono"
              style={{
                height: 240,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: tokens.ink[400],
                fontSize: 11,
              }}
            >
              {markersQ.isLoading
                ? "loading…"
                : "no marker activity in the selected window"}
            </div>
          )}
        </div>
      </Card>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 24,
          marginTop: 24,
        }}
      >
        <Card>
          <SectionLabel>Markers by lifecycle event</SectionLabel>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
              marginTop: 14,
            }}
          >
            {[
              {
                l: "Bond markers",
                v: markersQ.data?.breakdown.bondPct ?? 0,
                c: tokens.neon,
              },
              {
                l: "Unbond markers",
                v: markersQ.data?.breakdown.unbondPct ?? 0,
                c: tokens.cc,
              },
            ].map((r) => (
              <div key={r.l}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginBottom: 4,
                  }}
                >
                  <span
                    className="mono"
                    style={{ fontSize: 11, color: tokens.ink[200] }}
                  >
                    {r.l}
                  </span>
                  <span
                    className="mono tabular"
                    style={{ fontSize: 11, color: r.c }}
                  >
                    {r.v.toFixed(1)}%
                  </span>
                </div>
                <div style={{ height: 4, background: tokens.ink[700] }}>
                  <div
                    style={{ width: `${r.v}%`, height: "100%", background: r.c }}
                  />
                </div>
              </div>
            ))}
            <div
              className="mono"
              style={{ fontSize: 10, color: tokens.ink[400], marginTop: 6 }}
            >
              {markersQ.data
                ? `${markersQ.data.breakdown.bondCount} bonded · ${markersQ.data.breakdown.unbondCount} unbonding`
                : "—"}
            </div>
          </div>
        </Card>
        <Card>
          <SectionLabel>System health</SectionLabel>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto",
              gap: "10px 16px",
              marginTop: 14,
              fontSize: 11.5,
            }}
          >
            <span className="mono" style={{ color: tokens.ink[300] }}>
              CC round automation
            </span>
            <span
              className="mono"
              style={{
                color:
                  healthQ.data?.status === "ok"
                    ? tokens.neon
                    : healthQ.data?.status === "failing"
                      ? tokens.danger
                      : tokens.ink[400],
              }}
            >
              {healthQ.data?.status === "ok"
                ? "● Round worker OK"
                : healthQ.data?.status === "failing"
                  ? "● Round worker failing"
                  : healthQ.data?.status === "idle"
                    ? "○ no rounds yet"
                    : `● ${healthQ.data?.status ?? "loading"}`}
            </span>
            <span className="mono" style={{ color: tokens.ink[300] }}>
              Marker success rate
            </span>
            <span className="mono tabular" style={{ color: tokens.neon }}>
              {healthQ.data?.successRatePct !== null &&
              healthQ.data?.successRatePct !== undefined
                ? `${healthQ.data.successRatePct}% · last ${healthQ.data.totalSampled}`
                : "—"}
            </span>
            <span className="mono" style={{ color: tokens.ink[300] }}>
              Last round
            </span>
            <span className="mono tabular" style={{ color: tokens.ink[100] }}>
              {healthQ.data?.lastRound
                ? `#${healthQ.data.lastRound.roundNumber} · ${healthQ.data.lastRound.status}`
                : "—"}
            </span>
          </div>
        </Card>
      </div>

      <Card style={{ marginTop: 24 }}>
        <SectionLabel>§ Insight</SectionLabel>
        <div
          className="display"
          style={{
            fontSize: 22,
            color: tokens.ink[100],
            marginTop: 6,
            lineHeight: 1.4,
          }}
        >
          {markersQ.data?.insight.deltaPct !== null &&
          markersQ.data?.insight.deltaPct !== undefined ? (
            <>
              Marker emissions are{" "}
              <span
                style={{
                  color:
                    markersQ.data.insight.deltaPct >= 0
                      ? tokens.neon
                      : tokens.warning,
                }}
              >
                {markersQ.data.insight.deltaPct >= 0 ? "+" : ""}
                {markersQ.data.insight.deltaPct.toFixed(1)}%
              </span>{" "}
              versus the previous {CHART_HOURS}h. Bond events currently account
              for {markersQ.data.breakdown.bondPct.toFixed(0)}% of activity.
            </>
          ) : (
            <>Marker history is too short for a window-over-window comparison.</>
          )}
        </div>
        <div
          className="mono"
          style={{
            fontSize: 11,
            color: tokens.ink[400],
            marginTop: 10,
            lineHeight: 1.7,
            maxWidth: 780,
          }}
        >
          {healthQ.data?.successRatePct !== null &&
          healthQ.data?.successRatePct !== undefined
            ? `Round automation has succeeded on ${healthQ.data.successRatePct}% of the last ${healthQ.data.totalSampled} attempts.`
            : "Round automation health is being sampled."}{" "}
          Polygon Amoy and Canton ledger latency are not currently
          instrumented.
        </div>
      </Card>
    </div>
  );
}
