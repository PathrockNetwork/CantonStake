"use client";

import { Chip } from "@/components/primitives/Chip";
import { SectionLabel } from "@/components/primitives/SectionLabel";
import { tokens } from "@/lib/tokens";

/**
 * Beneficiary split flow diagram. CC round mint trunks into a 75/25 split:
 * 75% to delegator's Loop party (neon), 25% to app treasury (amber/cc).
 *
 * Ported verbatim from handoff/prototype/redesign/screens.jsx
 * (`BeneficiaryPipeline`). Pixel-tuned SVG coordinates — do NOT
 * restructure without comparing to the prototype.
 *
 * The 309.6 / 103.2 CC numbers are demo placeholders. The Daml ledger is
 * the source of truth at runtime; wire actual user/treasury totals when
 * porting screens that consume this component (Step 6+).
 */
export function BeneficiaryPipeline({
  userCc = 309.6,
  treasuryCc = 103.2,
}: {
  userCc?: number;
  treasuryCc?: number;
}) {
  return (
    <div
      style={{
        position: "relative",
        height: 240,
        background: tokens.ink[900],
        border: `1px solid ${tokens.hairline}`,
        padding: "20px 24px",
        overflow: "hidden",
        borderRadius: 0,
      }}
    >
      <svg
        width="100%"
        height="200"
        viewBox="0 0 1000 200"
        style={{ position: "absolute", left: 0, top: 30 }}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="flowG" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor={tokens.cc} />
            <stop offset="1" stopColor={tokens.neon} />
          </linearGradient>
        </defs>
        {/* trunk */}
        <line x1="60" y1="100" x2="500" y2="100" stroke={tokens.ink[600]} strokeWidth="2" />
        <line
          x1="60"
          y1="100"
          x2="500"
          y2="100"
          stroke="url(#flowG)"
          strokeWidth="2"
          strokeDasharray="6 6"
          style={{ animation: "flow-dash 2s linear infinite" }}
        />
        {/* split: 75 user (top), 25 treasury (bottom) */}
        <path
          d="M 500 100 Q 580 100 580 50 L 920 50"
          fill="none"
          stroke={tokens.neon}
          strokeWidth="2"
          strokeDasharray="6 6"
          style={{ animation: "flow-dash 2s linear infinite" }}
        />
        <path
          d="M 500 100 Q 580 100 580 150 L 920 150"
          fill="none"
          stroke={tokens.cc}
          strokeWidth="1.4"
          strokeDasharray="6 6"
          style={{ animation: "flow-dash 3s linear infinite" }}
        />
        {/* nodes */}
        <circle cx="60" cy="100" r="6" fill={tokens.cc} />
        <circle
          cx="500"
          cy="100"
          r="8"
          fill={tokens.ink[900]}
          stroke={tokens.ink[300]}
          strokeWidth="1.5"
        />
        <circle cx="920" cy="50" r="6" fill={tokens.neon} />
        <circle cx="920" cy="150" r="6" fill={tokens.cc} />
      </svg>

      {/* Source */}
      <div style={{ position: "absolute", left: 24, top: 54 }}>
        <SectionLabel>SOURCE</SectionLabel>
        <div
          className="display"
          style={{ fontSize: 22, color: tokens.ink[100], marginTop: 2 }}
        >
          CC round mint
        </div>
        <div
          className="mono"
          style={{ fontSize: 10, color: tokens.ink[400] }}
        >
          Super Validator · every 10 minutes
        </div>
      </div>

      {/* Split fork label */}
      <div style={{ position: "absolute", left: 430, top: 128 }}>
        <SectionLabel>SPLIT</SectionLabel>
        <div
          className="mono"
          style={{ fontSize: 11, color: tokens.ink[300], marginTop: 2 }}
        >
          BeneficiaryConfig
        </div>
        <div
          className="mono"
          style={{ fontSize: 9.5, color: tokens.ink[500], marginTop: 2 }}
        >
          weights encoded in Daml
        </div>
      </div>

      {/* User branch */}
      <div
        style={{ position: "absolute", right: 24, top: 30, textAlign: "right" }}
      >
        <Chip color={tokens.neon}>USER · 75%</Chip>
        <div
          className="display tabular"
          style={{ fontSize: 24, color: tokens.ink[100], marginTop: 4 }}
        >
          {userCc.toFixed(1)} CC
        </div>
        <div
          className="mono"
          style={{ fontSize: 10, color: tokens.ink[400] }}
        >
          direct to Loop party
        </div>
      </div>

      {/* Treasury branch */}
      <div
        style={{ position: "absolute", right: 24, top: 142, textAlign: "right" }}
      >
        <Chip color={tokens.cc}>TREASURY · 25%</Chip>
        <div
          className="display tabular"
          style={{ fontSize: 18, color: tokens.ink[200], marginTop: 4 }}
        >
          {treasuryCc.toFixed(1)} CC
        </div>
        <div
          className="mono"
          style={{ fontSize: 10, color: tokens.ink[400] }}
        >
          app treasury party
        </div>
      </div>
    </div>
  );
}
