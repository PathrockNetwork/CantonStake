import type { PositionRow, RoundSummary } from "./api";
import { CHAINS, chainFromAddress } from "./chains";
import { lookupPositionChain } from "./position-chain-map";
import type { PriceSnapshot } from "./prices";

export function accountChain(position: PositionRow) {
  const recorded = CHAINS.find(chain => position.chainMeta?.chain === chain.id || position.chainMeta?.chain?.startsWith(`${chain.id}-`));
  return chainFromAddress(position.argument.evmAddress,
    recorded?.id ?? lookupPositionChain(position.argument.evmAddress, position.argument.amountPol));
}
export function shortId(value?: string | null, length = 8) {
  if (!value) return "—";
  return value.length > length + 5 ? `${value.slice(0, length)}…${value.slice(-4)}` : value;
}
export function positionUsd(position: PositionRow, prices?: PriceSnapshot): number | null {
  if (!prices) return null;
  const keys: Record<string, keyof PriceSnapshot> = { polygon: "polUsd", monad: "monUsd", cosmos: "atomUsd", sui: "suiUsd", celestia: "tiaUsd", osmosis: "osmoUsd", aptos: "aptUsd", polkadot: "dotUsd", bnb: "bnbUsd", solana: "solUsd" };
  const chain = CHAINS.find(chain => position.chainMeta?.chain === chain.id || position.chainMeta?.chain?.startsWith(`${chain.id}-`));
  if (!chain) return null;
  const price = prices[keys[chain.id]];
  const amount = Number(position.argument.amountPol);
  return typeof price === "number" && Number.isFinite(price) && price > 0 && Number.isFinite(amount) && amount >= 0 ? price * amount : null;
}
export function totalPositionUsd(positions: PositionRow[], prices?: PriceSnapshot): number | null {
  if (!prices) return null;
  let total = 0;
  for (const position of positions) { const value = positionUsd(position, prices); if (value === null) return null; total += value; }
  return total;
}
export function validatorLabel(position: PositionRow) {
  return shortId(position.chainMeta?.validatorAddress ?? position.chainMeta?.validatorShare);
}
export type AccountEvent = { id: string; time: string; title: string; detail: string; status: string; kind: "positions" | "rewards"; positionId?: string; round?: number };
/** Recorded timestamps only: never synthesize watcher confirmations or reward amounts. */
export function accountEvents(positions: PositionRow[], rounds: RoundSummary[], userScope = true): AccountEvent[] {
  const events: AccountEvent[] = [];
  for (const p of positions) {
    for (const [time, title, status] of [
      [p.argument.bondedAt, "Position bonded", "Bonded"],
      [p.argument.unbondingStartedAt, "Unbonding started", "Unbonding"],
      [p.argument.releasedAt, "Position released", "Released"],
    ]) {
      if (time && Number.isFinite(Date.parse(time))) events.push({ id: `${p.contractId}-${status}`, time, title: title!, status: status!, kind: "positions", positionId: p.contractId,
        detail: `${p.argument.amountPol} ${accountChain(p).symbol} · ${shortId(p.contractId)}` });
    }
  }
  for (const r of rounds) {
    if (userScope && r.userCcAttributed == null) continue;
    const time = r.completedAt ?? r.startedAt;
    if (!Number.isFinite(Date.parse(time))) continue;
    events.push({ id: `round-${r.roundNumber}`, time, title: userScope ? "CC round attribution" : "CC reward round", kind: "rewards", status: r.status, round: r.roundNumber,
      detail: `Round #${r.roundNumber.toLocaleString()} · ${userScope ? r.userCcAttributed : r.totalCcMinted} CC ${userScope ? "attributed before split" : "minted"}` });
  }
  return events.sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
}
