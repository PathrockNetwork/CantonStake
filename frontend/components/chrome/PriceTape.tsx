"use client";

import { tokens } from "@/lib/tokens";

/**
 * Bloomberg-style auto-scrolling ticker tape, ported from
 * handoff/prototype/redesign/components.jsx (`PriceTape`).
 *
 * The values are static demo numbers — see `COPY_DECK.md`. Real wiring
 * (CC/USD price feed, block height, marker counts) is out of scope here;
 * swap the array contents at the data layer when those feeds exist.
 *
 * The tape duplicates the row twice so the CSS `ticker` keyframe can
 * translateX(-50%) seamlessly. CSS `:hover { animation-play-state: paused }`
 * (in globals.css) lets users freeze the tape to read.
 */

type TapeItem = {
  symbol: string;
  price: string;
  delta: string;
  up: boolean;
};

const ITEMS: TapeItem[] = [
  { symbol: "CC/USD", price: "$0.16", delta: "+2.4%", up: true },
  { symbol: "POL/USD", price: "$0.42", delta: "-0.8%", up: false },
  { symbol: "NETWORK SHARE", price: "2.41%", delta: "+0.12pt", up: true },
  { symbol: "ROUND", price: "#2,873,541", delta: "LIVE", up: true },
  { symbol: "MARKERS·24H", price: "1,247", delta: "+18%", up: true },
  { symbol: "CC MINTED·R", price: "412.8", delta: "+62%", up: true },
  { symbol: "BENEFICIARY", price: "75/25", delta: "ON-LEDGER", up: true },
  { symbol: "AMOY", price: "OK", delta: "42ms", up: true },
  { symbol: "CANTON", price: "OK", delta: "PARTICIPANT-1", up: true },
];

function Row() {
  return (
    <>
      {ITEMS.map((it, i) => (
        <div
          key={`${it.symbol}-${i}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            paddingRight: 32,
          }}
        >
          <span
            className="mono"
            style={{ fontSize: 10, color: tokens.ink[400], letterSpacing: ".06em" }}
          >
            {it.symbol}
          </span>
          <span
            className="mono tabular"
            style={{ fontSize: 10.5, color: tokens.ink[100], fontWeight: 600 }}
          >
            {it.price}
          </span>
          <span
            className="mono tabular"
            style={{ fontSize: 10, color: it.up ? tokens.neon : tokens.danger }}
          >
            {it.up ? "▲" : "▼"} {it.delta}
          </span>
        </div>
      ))}
    </>
  );
}

export function PriceTape() {
  return (
    <div
      style={{
        borderTop: `1px solid ${tokens.hairline}`,
        borderBottom: `1px solid ${tokens.hairline}`,
        background: tokens.ink[900],
        overflow: "hidden",
        padding: "6px 0",
      }}
    >
      <div className="ticker">
        <Row />
        <Row />
      </div>
    </div>
  );
}
