"use client";

import { usePrices } from "@/lib/prices";
import { networkMode } from "@/lib/network";
import { useProtocolStatus } from "@/lib/use-protocol-status";

function number(value: number | undefined) {
  return value !== undefined && Number.isFinite(value)
    ? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value) : "—";
}

export function PriceTape() {
  const { data: prices } = usePrices();
  const { health, live, label, isError } = useProtocolStatus();
  const round = !isError ? health?.lastRound ?? null : null;
  const delta = prices?.polUsd24hChange;
  return (
    <div className={`network-tape network-tape--${networkMode}`}>
      <div className="network-tape__viewport mono" role="region" aria-label="Bloomberg-style moving market and protocol terminal" tabIndex={0}>
        <div className="network-tape__track">
          <TapeItems prices={prices} round={round} live={live} label={label} isError={isError} health={health} delta={delta} />
          <TapeItems prices={prices} round={round} live={live} label={label} isError={isError} health={health} delta={delta} duplicate />
        </div>
      </div>
      <div className="network-tape__motto mono" aria-hidden="true"><span>Secure</span><i /><span>Stake</span><i /><span>Grow</span><i /><span>Together</span></div>
    </div>
  );
}

function TapeItems({ prices, round, live, label, isError, health, delta, duplicate = false }: {
  prices: ReturnType<typeof usePrices>["data"];
  round: ReturnType<typeof useProtocolStatus>["health"] extends infer Health
    ? Health extends { lastRound?: infer Round } ? Round | null : null
    : null;
  live: boolean;
  label: string;
  isError: boolean;
  health: ReturnType<typeof useProtocolStatus>["health"];
  delta: number | null | undefined;
  duplicate?: boolean;
}) {
  return <div className="network-tape__set" aria-hidden={duplicate || undefined}>
    <span className="network-tape__identity">CANTON NETWORK</span>
    <div><span>ROUND</span><b>{round ? `#${round.roundNumber.toLocaleString()}` : "—"}</b><em className={live ? "is-live" : "is-pending"}><i />{label}</em></div>
    <div title="CC attributed in the latest completed reward round"><span>CC ATTRIBUTED</span><b>{number(round ? Number(round.totalCcMinted) : undefined)}</b></div>
    <div><span>BENEFICIARY</span><b>75/25</b><em className="is-live"><i />ON-LEDGER</em></div>
    <div title="Successful reward runs in the latest sample"><span>REWARD HEALTH</span><b>{!isError && health?.successRatePct != null ? `${health.successRatePct.toFixed(1)}%` : "—"}</b></div>
    <div title={prices?.source.pol === "coingecko" ? "Market reference from CoinGecko" : "Indicative reference price; not a live market quote"}><span>POL/USD</span><b>{prices ? `$${prices.polUsd.toFixed(3)}` : "—"}</b>{delta != null ? <em className={delta >= 0 ? "is-live" : "is-negative"}>{delta >= 0 ? "+" : ""}{delta.toFixed(1)}%</em> : <em>REF</em>}</div>
  </div>;
}
