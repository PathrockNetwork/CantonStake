export interface ProtocolSummary {
  activePositions: number;
  bondedPositions: number;
  stakedByChain: Record<string, number>;
  amountsComplete: boolean;
  asOf: string | null;
  source: "ledger" | "recorded";
}

/** Never price an unknown chain as POL or silently show a partial total. */
export function valueStaked(summary: ProtocolSummary, usdByChain: Record<string, number>): number | null {
  if (!summary.amountsComplete) return null;
  let total = 0;
  for (const [chain, amount] of Object.entries(summary.stakedByChain)) {
    const price = usdByChain[chain];
    if (!Number.isFinite(price) || price <= 0) return null;
    total += amount * price;
  }
  return Number.isFinite(total) ? total : null;
}
