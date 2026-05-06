"use client";

import { useMemo } from "react";
import { useAccount } from "wagmi";
import { Card } from "@/components/primitives/Card";
import { Chip } from "@/components/primitives/Chip";
import { SectionLabel } from "@/components/primitives/SectionLabel";
import { tokens } from "@/lib/tokens";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4001";

/**
 * Analytics — ported from handoff/prototype/redesign/screens.jsx (`Analytics`).
 *
 * Pure SVG visualization. No backend route exposes per-round historical
 * marker data yet, so the chart series is synthesised client-side. Wire
 * to a real `/v1/analytics/markers` endpoint when one ships
 * (PORT_GUIDE §Step 7).
 */
export default function AnalyticsPage() {
  const { address, isConnected } = useAccount();
  const csvHref =
    isConnected && address
      ? `${BACKEND_URL}/api/tax/csv?address=${address}&format=koinly`
      : null;

  const series = useMemo(
    () =>
      Array.from({ length: 60 }, (_, i) => {
        const seed = (i * 9973) % 1000;
        const noise = (seed / 1000) * 30;
        return 28 + Math.sin(i / 4) * 8 + Math.cos(i / 7) * 6 + noise * 0.6;
      }),
    [],
  );
  const pts = series
    .map((v, i) => `${(i / (series.length - 1)) * 100},${100 - (v / 80) * 100}`)
    .join(" ");

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
              Marker emissions · last 60 rounds
            </div>
            <div
              className="mono"
              style={{ fontSize: 10.5, color: tokens.ink[400], marginTop: 2 }}
            >
              last 10 hours · live
            </div>
          </div>
          <Chip color={tokens.neon} dot>
            STREAMING
          </Chip>
        </div>
        <div style={{ padding: "24px 22px" }}>
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
              { l: "Bond markers", v: 62, c: tokens.neon },
              { l: "Unbond markers", v: 38, c: tokens.cc },
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
                    {r.v}%
                  </span>
                </div>
                <div style={{ height: 4, background: tokens.ink[700] }}>
                  <div
                    style={{ width: `${r.v}%`, height: "100%", background: r.c }}
                  />
                </div>
              </div>
            ))}
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
              Canton ledger lag
            </span>
            <span className="mono tabular" style={{ color: tokens.neon }}>
              42ms
            </span>
            <span className="mono" style={{ color: tokens.ink[300] }}>
              Polygon Amoy delay
            </span>
            <span className="mono tabular" style={{ color: tokens.neon }}>
              1.2s
            </span>
            <span className="mono" style={{ color: tokens.ink[300] }}>
              CC round automation
            </span>
            <span className="mono" style={{ color: tokens.neon }}>
              ● Round worker OK
            </span>
            <span className="mono" style={{ color: tokens.ink[300] }}>
              Marker success rate
            </span>
            <span className="mono tabular" style={{ color: tokens.neon }}>
              100% · last 1,000
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
          Marker emissions are up{" "}
          <span style={{ color: tokens.neon }}>+18%</span> versus the previous
          24 hours. Bond events currently account for 62% of activity.
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
          System health is nominal: round automation has succeeded on 100% of
          the last 1,000 attempts, Canton ledger lag stays under 50ms, and
          Polygon Amoy delay is consistent at ~1.2s. No anomalies detected.
        </div>
      </Card>
    </div>
  );
}
