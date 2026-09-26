import type { PositionRow, RoundSummary } from "./api";
import { CHAINS, chainFromAddress } from "./chains";
import { lookupPositionChain } from "./position-chain-map";
import type { PriceSnapshot } from "./prices";
import { isMainnet } from "./network";

function recordedAccountChain(raw: string | undefined) {
  return CHAINS.find(chain => raw === chain.id || raw === `${chain.id}-mainnet` ||
    raw === `${chain.id}-testnet` || (chain.id === "polygon" && raw === "polygon-amoy"));
}

export function accountChain(position: PositionRow) {
  const recorded = recordedAccountChain(position.chainMeta?.chain);
  return chainFromAddress(position.argument.evmAddress,
    recorded?.id ?? lookupPositionChain(position.argument.evmAddress, position.argument.amountPol));
}
export function shortId(value?: string | null, length = 8) {
  if (!value) return "—";
  return value.length > length + 5 ? `${value.slice(0, length)}…${value.slice(-4)}` : value;
}
export function positionUsd(position: PositionRow, prices?: PriceSnapshot, mainnet = isMainnet): number | null {
  // Faucet/testnet assets do not have a real USD price, even when the native
  // mainnet token happens to use the same symbol.
  if (!prices || !mainnet) return null;
  if (position.chainMeta?.chain?.endsWith("-testnet") || position.chainMeta?.chain === "polygon-amoy") return null;
  const keys: Record<string, keyof PriceSnapshot> = { polygon: "polUsd", monad: "monUsd", cosmos: "atomUsd", sui: "suiUsd", celestia: "tiaUsd", osmosis: "osmoUsd", aptos: "aptUsd", polkadot: "dotUsd", bnb: "bnbUsd", solana: "solUsd" };
  const chain = recordedAccountChain(position.chainMeta?.chain);
  if (!chain) return null;
  const price = prices[keys[chain.id]];
  const amount = Number(position.argument.amountPol);
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0 || !Number.isFinite(amount) || amount < 0) return null;
  const value = price * amount;
  return Number.isFinite(value) ? value : null;
}
export function totalPositionUsd(positions: PositionRow[], prices?: PriceSnapshot, mainnet = isMainnet): number | null {
  if (!prices) return null;
  let total = 0;
  for (const position of positions) { const value = positionUsd(position, prices, mainnet); if (value === null) return null; total += value; if (!Number.isFinite(total)) return null; }
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
