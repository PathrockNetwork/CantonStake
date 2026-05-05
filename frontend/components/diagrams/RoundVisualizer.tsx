"use client";

import { Card } from "@/components/primitives/Card";
import { SectionLabel } from "@/components/primitives/SectionLabel";
import { fmt } from "@/lib/format";
import { tokens } from "@/lib/tokens";
import { useRoundCountdown } from "@/lib/use-round-countdown";

const RING_RADIUS = 52;
const RING_CIRC = 2 * Math.PI * RING_RADIUS;

/**
 * Live round visualizer. Shows the current 10-minute mint cycle:
 *   - Circular SVG progress ring with MM:SS countdown in the center
 *   - Estimated CC accruing this round (75/25 user/treasury split)
 *
 * Estimates are derived from the user's historical per-round average,
 * scaled by round progress. They are advisory — actual mint values come
 * from the Scan API at round close. The component is the on-screen
 * "demo climax" for /rewards: it converts the abstract idea of round
 * cadence into a visible, live ticker.
 */
export function RoundVisualizer({
  userCc,
  treasuryCc,
  rewardEventCount,
}: {
  userCc: number;
  treasuryCc: number;
  rewardEventCount: number;
}) {
  const { mm, ss, progress, roundId } = useRoundCountdown();

  const totalCc = userCc + treasuryCc;
  const avgCcPerRound = rewardEventCount > 0 ? totalCc / rewardEventCount : 0;
  const estimatedCcThisRound = avgCcPerRound * progress;
  const userShare = estimatedCcThisRound * 0.75;
  const treasuryShare = estimatedCcThisRound * 0.25;

  const closingSoon = progress > 0.9;
  const ringStroke = closingSoon ? tokens.cc : tokens.neon;

  return (
    <Card style={{ marginBottom: 24 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 14,
        }}
      >
        <SectionLabel>§ Live round · #{roundId}</SectionLabel>
        <div
          className="mono"
          style={{
            fontSize: 10.5,
            color: closingSoon ? tokens.cc : tokens.ink[400],
            animation: closingSoon
              ? "pulse-dot 2.4s ease-in-out infinite"
              : undefined,
          }}
        >
          mints every 10 min
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "120px 1fr",
          gap: 24,
          alignItems: "center",
        }}
      >
        <svg width="120" height="120" viewBox="0 0 120 120" aria-hidden="true">
          <circle
            cx="60"
            cy="60"
            r={RING_RADIUS}
            fill="none"
            stroke={tokens.hairline}
            strokeWidth="6"
          />
          <circle
            cx="60"
            cy="60"
            r={RING_RADIUS}
            fill="none"
            stroke={ringStroke}
            strokeWidth="6"
            strokeLinecap="butt"
            strokeDasharray={`${progress * RING_CIRC} ${RING_CIRC}`}
            transform="rotate(-90 60 60)"
            style={{ transition: "stroke-dasharray 1s linear" }}
          />
          <text
            x="60"
            y="60"
            textAnchor="middle"
            dominantBaseline="central"
            fill={tokens.ink[100]}
            fontSize="22"
            fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {mm}:{ss}
          </text>
          <text
            x="60"
            y="86"
            textAnchor="middle"
            fill={tokens.ink[400]}
            fontSize="8"
            fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
            letterSpacing="1"
          >
            UNTIL MINT
          </text>
        </svg>

        <div>
          <SectionLabel>Estimated CC this round</SectionLabel>
          <div
            className="display tabular"
            style={{ fontSize: 32, color: tokens.cc, marginTop: 6 }}
          >
            {fmt(estimatedCcThisRound, 2)}
          </div>
          <div
            className="mono"
            style={{
              fontSize: 10.5,
              color: tokens.ink[400],
              marginTop: 4,
            }}
          >
            advisory · scales with round progress
          </div>

          <RoundShareRow
            label="you · 75%"
            color={tokens.neon}
            value={userShare}
            width={75}
            progress={progress}
          />
          <RoundShareRow
            label="treasury · 25%"
            color={tokens.cc}
            value={treasuryShare}
            width={25}
            progress={progress}
          />
        </div>
      </div>
    </Card>
  );
}

function RoundShareRow({
  label,
  color,
  value,
  width,
  progress,
}: {
  label: string;
  color: string;
  value: number;
  width: number;
  progress: number;
}) {
  return (
    <div
      style={{
        marginTop: 10,
        display: "grid",
        gridTemplateColumns: "100px 1fr 80px",
        gap: 10,
        alignItems: "center",
      }}
    >
      <div className="mono" style={{ fontSize: 11, color }}>
        {label}
      </div>
      <div
        style={{
          height: 4,
          background: tokens.hairline,
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            width: `${width}%`,
            background: color,
            opacity: 0.55 + progress * 0.45,
            transition: "opacity 1s linear",
          }}
        />
      </div>
      <div
        className="mono tabular"
        style={{
          fontSize: 11,
          color,
          textAlign: "right",
        }}
      >
        {fmt(value, 2)} CC
      </div>
    </div>
  );
}
