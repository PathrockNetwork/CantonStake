import type { ActiveContract } from "../canton.js";
import { sameWalletAddress } from "./wallet-address.js";
import { deploymentChain } from "./deployment-scope.js";

export const PORTFOLIO_CHAINS = [
  "polygon", "monad", "cosmos", "celestia", "osmosis", "sui",
  "aptos", "polkadot", "bnb", "solana",
] as const;

export type PortfolioChain = (typeof PORTFOLIO_CHAINS)[number];

export function validPortfolioAddress(address: string): boolean {
  return /^0x(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/.test(address) ||
    /^(?:cosmos|celestia|osmo)1[023456789acdefghjklmnpqrstuvwxyz]{20,90}$/.test(address) ||
    /^(?:[1-9A-HJ-NP-Za-km-z]{32,44}|[1-9A-HJ-NP-Za-km-z]{47,49})$/.test(address);
}

export type RecordedPositionMeta = {
  contractId: string;
  chain: string;
  validatorAddress: string | null;
  validatorShare: string | null;
};

export type RecordedDelegation = {
  chain: PortfolioChain;
  validator: string;
  amount: string;
  symbol: string;
  status: "bonded" | "unbonding";
};

export function portfolioUsdTotal(
  rows: Array<{ amount: string; symbol: string }>,
  prices: Record<string, number>,
  mode: "testnet" | "mainnet",
  unclassifiedPositions: number,
): number | null {
  if (mode !== "mainnet" || unclassifiedPositions > 0) return null;
  let total = 0;
  for (const row of rows) {
    const amount = Number(row.amount);
    const price = prices[row.symbol];
    if (!Number.isFinite(amount) || amount < 0 ||
        typeof price !== "number" || !Number.isFinite(price) || price <= 0) return null;
    total += amount * price;
    if (!Number.isFinite(total)) return null;
  }
  return total;
}

const symbols: Record<PortfolioChain, string> = {
  polygon: "POL", monad: "MON", cosmos: "ATOM", celestia: "TIA",
  osmosis: "OSMO", sui: "SUI", aptos: "APT", polkadot: "DOT",
  bnb: "BNB", solana: "SOL",
};

function knownChain(raw: string, mode: "testnet" | "mainnet"): PortfolioChain | null {
  return deploymentChain(raw, mode) as PortfolioChain | null;
}

/** Canton owns lifecycle and amount; Postgres supplies the chain/validator.
 * Missing metadata is surfaced as incomplete rather than guessed as Polygon. */
export function recordedDelegations(
  contracts: ActiveContract[],
  mirrors: RecordedPositionMeta[],
  address: string,
  mode: "testnet" | "mainnet",
): { rows: RecordedDelegation[]; unclassifiedPositions: number } {
  const byCid = new Map(mirrors.map((mirror) => [mirror.contractId, mirror]));
  const rows: RecordedDelegation[] = [];
  let unclassifiedPositions = 0;
  for (const contract of contracts) {
    const arg = contract.argument as { evmAddress?: string; amountPol?: string | number; status?: string };
    if (!sameWalletAddress(arg.evmAddress, address) || !["Bonded", "Unbonding"].includes(arg.status ?? "")) continue;
    const mirror = byCid.get(contract.contractId);
    const chain = mirror ? knownChain(mirror.chain, mode) : null;
    const amount = String(arg.amountPol ?? "");
    if (!chain || !/^\d+(?:\.\d+)?$/.test(amount) || Number(amount) <= 0) {
      unclassifiedPositions++;
      continue;
    }
    rows.push({
      chain,
      validator: mirror!.validatorAddress || mirror!.validatorShare || "",
      amount,
      symbol: chain === "polkadot" && mode === "testnet" ? "WND" : symbols[chain],
      status: arg.status === "Bonded" ? "bonded" : "unbonding",
    });
  }
  return { rows, unclassifiedPositions };
}
