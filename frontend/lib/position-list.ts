import { formatEther } from "viem";
import type { PositionRow } from "./api";
import { accountChain, validatorLabel } from "./account-view";
import { assertLiquidState, type LiquidState } from "./polygon-liquid";

type ListFields = { id: string; chainId: string; chainName: string; symbol: string; amount: string; status: string; route: string; timestamp: number | null };
export type ListedPosition = ListFields & ({ kind: "validator"; position: PositionRow } | { kind: "liquid"; state: LiquidState });

// Liquid holdings are a wallet balance, not a synthetic validator contract.
export function positionList(positions: PositionRow[], state?: LiquidState, wallet?: string): ListedPosition[] {
  const entries: ListedPosition[] = positions.map(position => {
    const chain = accountChain(position);
    return { kind: "validator", position, id: position.contractId, chainId: chain.id,
      chainName: chain.id === "polygon" ? "Polygon PoS" : chain.name, symbol: chain.symbol,
      amount: position.argument.amountPol, status: position.argument.status, route: validatorLabel(position),
      timestamp: Date.parse(position.argument.bondedAt ?? "") || null };
  });
  if (state && wallet) {
    try {
      assertLiquidState(state, wallet);
      if (BigInt(state.sharesBalance!) > 0n) entries.push({ kind: "liquid", state,
        id: `liquid:80002:${state.token}:${wallet}`.toLowerCase(), chainId: "polygon", chainName: "Polygon Amoy",
        symbol: "sPOL", amount: formatEther(BigInt(state.sharesBalance!)), status: "Active", route: "Pooled sPOL holdings", timestamp: null });
    } catch { /* Invalid or stale wallet data cannot create a list entry. */ }
  }
  return entries;
}

export function filterPositionList(entries: ListedPosition[], filters: { status: string; chain: string; kind: string; search: string; order: string }) {
  return entries.filter(entry => (filters.status === "all" || entry.status === filters.status)
    && (filters.chain === "all" || entry.chainId === filters.chain)
    && (filters.kind === "all" || entry.kind === filters.kind)
    && `${entry.id} ${entry.chainName} ${entry.symbol} ${entry.route} ${entry.kind === "liquid" ? "Liquid staking" : "Validator staking"} ${entry.kind === "validator" ? `${entry.position.chainMeta?.validatorAddress ?? ""} ${entry.position.chainMeta?.validatorShare ?? ""}` : ""}`.toLowerCase().includes(filters.search.toLowerCase()))
    .sort((a, b) => {
      if (filters.order === "amount") return Number(b.amount) - Number(a.amount);
      // Holdings have no single deposit timestamp; don't invent a bond date.
      if (a.timestamp === null || b.timestamp === null) return a.timestamp === b.timestamp ? 0 : a.timestamp === null ? 1 : -1;
      return (filters.order === "oldest" ? 1 : -1) * (a.timestamp - b.timestamp);
    });
}
