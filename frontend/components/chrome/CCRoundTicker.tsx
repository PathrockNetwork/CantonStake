"use client";

import { IconCoin } from "@/components/icons";
import { useProtocolStatus } from "@/lib/use-protocol-status";
import { useRoundCountdown } from "@/lib/use-round-countdown";

export function CCRoundTicker({ compact = false }: { compact?: boolean }) {
  const { mm, ss, progress } = useRoundCountdown();
  const { health, isError } = useProtocolStatus();
  const round = !isError ? health?.lastRound?.roundNumber : undefined;
  return (
    <div className={`cc-round-ticker mono${compact ? " cc-round-ticker--compact" : ""}`} title="Latest recorded round. Countdown follows the estimated 10-minute cadence; settlement timing can vary.">
      <IconCoin size={12} />
      <div><span>CC ROUND {round === undefined ? "—" : `#${round.toLocaleString()}`}</span><span>NEXT IN <b>{mm}:{ss}</b></span></div>
      <span className="cc-round-ticker__progress" aria-hidden="true"><i style={{ width: `${progress * 100}%` }} /></span>
    </div>
  );
}
