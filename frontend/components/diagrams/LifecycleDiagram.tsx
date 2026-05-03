"use client";

import { Chip } from "@/components/primitives/Chip";
import { tokens } from "@/lib/tokens";

/**
 * Animated 4-stage lifecycle diagram — Request / Bond / Unbond / Release.
 * Two horizontal tracks (Canton + Polygon) connected by vertical bridges
 * at the bond/unbond stages. Marker dots pulse at the marker-emitting
 * stages. Track segments have flowing dashes via the `flow-dash` keyframe.
 *
 * Ported verbatim from handoff/prototype/redesign/screens.jsx
 * (`LifecycleDiagram`). Pixel-tuned — do NOT restructure the SVG without
 * comparing side-by-side against the prototype HTML.
 */

type Stage = {
  id: string;
  title: string;
  sub: string;
  poly: string;
  marker: boolean;
};

const STAGES: Stage[] = [
  {
    id: "request",
    title: "Request",
    sub: "Canton staking intent created",
    poly: "—",
    marker: false,
  },
  {
    id: "bond",
    title: "Bond",
    sub: "Position bonded · marker emitted",
    poly: "buyVoucher → ShareMinted",
    marker: true,
  },
  {
    id: "unbond",
    title: "Unbond",
    sub: "Exit started · marker emitted",
    poly: "sellVoucher_new → ShareBurned",
    marker: true,
  },
  {
    id: "release",
    title: "Release",
    sub: "Position closed",
    poly: "unstakeClaimTokens_new",
    marker: false,
  },
];

// Explicit row Y-coordinates so labels never collide
const ROW = {
  trackLabel: 18,
  chip: 44,
  title: 80,
  sub: 122,
  cantonLine: 162,
  polyLine: 232,
  polyDetail: 256,
};

export function LifecycleDiagram() {
  return (
    <div
      style={{
        position: "relative",
        border: `1px solid ${tokens.hairline}`,
        background: `radial-gradient(ellipse at 50% 100%, rgba(0,255,157,.04), transparent 60%), ${tokens.ink[900]}`,
        padding: "0 28px 28px",
        height: 300,
        borderRadius: 0,
      }}
    >
      {/* Track labels */}
      <div
        className="mono"
        style={{
          position: "absolute",
          left: 28,
          top: ROW.cantonLine - 8,
          fontSize: 9.5,
          letterSpacing: ".18em",
          color: tokens.ink[400],
        }}
      >
        CANTON
      </div>
      <div
        className="mono"
        style={{
          position: "absolute",
          left: 28,
          top: ROW.polyLine - 8,
          fontSize: 9.5,
          letterSpacing: ".18em",
          color: tokens.ink[400],
        }}
      >
        POLYGON
      </div>

      {/* SVG tracks */}
      <svg
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
        }}
        preserveAspectRatio="none"
        viewBox="0 0 1000 300"
        aria-hidden="true"
      >
        <defs>
          <marker
            id="arrL"
            viewBox="0 0 6 6"
            refX="5"
            refY="3"
            markerWidth="6"
            markerHeight="6"
            orient="auto"
          >
            <path d="M0,0 L6,3 L0,6" fill={tokens.neon} />
          </marker>
        </defs>
        {/* Canton track */}
        <line
          x1="100"
          y1={ROW.cantonLine}
          x2="970"
          y2={ROW.cantonLine}
          stroke={tokens.hairline}
          strokeWidth="1"
        />
        <path
          d={`M 110 ${ROW.cantonLine} L 960 ${ROW.cantonLine}`}
          stroke={tokens.neon}
          strokeWidth="1.4"
          strokeDasharray="6 6"
          style={{ animation: "flow-dash 2s linear infinite" }}
          markerEnd="url(#arrL)"
        />
        {/* Polygon track */}
        <line
          x1="100"
          y1={ROW.polyLine}
          x2="970"
          y2={ROW.polyLine}
          stroke={tokens.hairline}
          strokeWidth="1"
        />
        <path
          d={`M 360 ${ROW.polyLine} L 640 ${ROW.polyLine}`}
          stroke={tokens.amberBright}
          strokeWidth="1.4"
          strokeDasharray="4 6"
          style={{ animation: "flow-dash 3s linear infinite" }}
        />
        {/* Vertical bridges at bond / unbond */}
        <line
          x1="360"
          y1={ROW.cantonLine}
          x2="360"
          y2={ROW.polyLine}
          stroke={tokens.neon}
          strokeWidth="1"
          strokeDasharray="2 3"
          opacity=".6"
        />
        <line
          x1="640"
          y1={ROW.cantonLine}
          x2="640"
          y2={ROW.polyLine}
          stroke={tokens.neon}
          strokeWidth="1"
          strokeDasharray="2 3"
          opacity=".6"
        />
      </svg>

      {/* Stage columns */}
      <div
        style={{
          position: "absolute",
          inset: "0 28px",
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
        }}
      >
        {STAGES.map((s, i) => (
          <div key={s.id} style={{ position: "relative", padding: "0 12px" }}>
            {/* chip row */}
            <div
              style={{
                position: "absolute",
                top: ROW.chip - 12,
                left: 12,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span
                className="mono"
                style={{
                  fontSize: 9,
                  color: tokens.ink[400],
                  letterSpacing: ".1em",
                }}
              >
                0{i + 1}
              </span>
              <Chip
                color={s.marker ? tokens.neon : tokens.ink[400]}
                dot={s.marker}
                style={{ fontSize: 9 }}
              >
                {s.id}
              </Chip>
            </div>
            {/* title */}
            <div
              className="display"
              style={{
                position: "absolute",
                top: ROW.title - 26,
                left: 12,
                fontSize: 24,
                color: tokens.ink[100],
                lineHeight: 1,
              }}
            >
              {s.title}
            </div>
            {/* sub on Canton */}
            <div
              className="mono"
              style={{
                position: "absolute",
                top: ROW.sub - 6,
                left: 12,
                fontSize: 10,
                color: tokens.ink[300],
                letterSpacing: ".04em",
              }}
            >
              {s.sub}
            </div>
            {/* Marker dot on Canton track */}
            {s.marker && (
              <div
                style={{
                  position: "absolute",
                  top: ROW.cantonLine - 5,
                  left: "50%",
                  marginLeft: -5,
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: tokens.neon,
                  boxShadow: `0 0 0 4px ${tokens.neonDim}`,
                  animation: "pulse-dot 1.6s infinite",
                }}
              />
            )}
            {/* Polygon detail */}
            <div
              className="mono"
              style={{
                position: "absolute",
                top: ROW.polyDetail,
                left: 12,
                fontSize: 10,
                color: tokens.ink[400],
                letterSpacing: ".04em",
              }}
            >
              {s.poly}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
