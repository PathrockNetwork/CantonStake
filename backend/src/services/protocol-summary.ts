import { deploymentChain, deploymentPositions, type NetworkMode } from "./deployment-scope.js";

/** Aggregate-only public read model. Never returns parties, wallets or contract IDs. */
export interface SummaryPosition {
  status: string;
  amount: string;
  chain: string;
}
export interface RecordedPosition extends SummaryPosition {
  contractId: string;
  updatedAt: Date;
}
export interface LedgerPosition {
  contractId: string;
  argument: Record<string, unknown>;
}

export function aggregatePositions(positions: SummaryPosition[]) {
  const active = positions.filter((p) => ["Pending", "Bonded", "Unbonding"].includes(p.status));
  const bonded = active.filter((p) => p.status === "Bonded");
  const stakedByChain: Record<string, number> = {};
  let amountsComplete = true;
  for (const position of bonded) {
    const chain = position.chain.replace(/-(amoy|testnet|mainnet)$/, "");
    const amount = /^\d+(\.\d+)?$/.test(position.amount) ? Number(position.amount) : NaN;
    if (!Number.isFinite(amount) || amount < 0 || ["__proto__", "constructor", "prototype"].includes(chain)) {
      amountsComplete = false;
      continue;
    }
    stakedByChain[chain] = (stakedByChain[chain] ?? 0) + amount;
    if (!Number.isFinite(stakedByChain[chain])) amountsComplete = false;
  }
  return { activePositions: active.length, bondedPositions: bonded.length, stakedByChain, amountsComplete };
}

export async function readProtocolSummary(deps: {
  readLedger: () => Promise<LedgerPosition[]>;
  readRecorded: () => Promise<RecordedPosition[]>;
  now: () => Date;
  networkMode: NetworkMode;
}) {
  const [ledger, recorded] = await Promise.allSettled([deps.readLedger(), deps.readRecorded()]);
  // Ledger visibility alone cannot identify the deployment. A failed local
  // database read must never fall back to counting every shared contract.
  if (recorded.status !== "fulfilled") throw new Error("Protocol totals are temporarily unavailable");
  if (ledger.status === "fulfilled") {
    const positions = deploymentPositions(ledger.value, recorded.value, deps.networkMode).map((p): SummaryPosition => ({
      status: String(p.argument.status ?? ""), amount: String(p.argument.amountPol ?? ""), chain: p.chainMeta.chain,
    }));
    return { ...aggregatePositions(positions), source: "ledger" as const, asOf: deps.now().toISOString() };
  }
  if (recorded.status === "fulfilled") {
    const scoped = recorded.value.filter(p => deploymentChain(p.chain, deps.networkMode));
    const latestUpdate = scoped.reduce((latest, p) => Math.max(latest, p.updatedAt.getTime()), 0);
    return {
      ...aggregatePositions(scoped), source: "recorded" as const,
      asOf: latestUpdate ? new Date(latestUpdate).toISOString() : null,
    };
  }
  throw new Error("Protocol totals are temporarily unavailable");
}
