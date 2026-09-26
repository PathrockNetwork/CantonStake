import { fromBech32 } from "@cosmjs/encoding";

type NativeChain = "cosmos" | "celestia" | "osmosis" | "sui";

const COSMOS_PREFIX: Record<Exclude<NativeChain, "sui">, string> = {
  cosmos: "cosmos",
  celestia: "celestia",
  osmosis: "osmo",
};

/** A malformed native intent cannot be matched to a wallet transaction. */
export function nativeStakeInputError(
  chain: NativeChain,
  wallet: string,
  validator: string | undefined,
  amount: string,
): string | null {
  const decimals = chain === "sui" ? 9 : 6;
  if (!new RegExp(`^\\d+(?:\\.\\d{1,${decimals}})?$`).test(amount)) {
    return `${chain} stake amount supports at most ${decimals} decimal places`;
  }
  if (chain === "sui") {
    if (!/^0x[a-fA-F0-9]{64}$/.test(wallet) || !validator || !/^0x[a-fA-F0-9]{64}$/.test(validator)) {
      return "Sui staking requires 32-byte wallet and validator addresses";
    }
    return null;
  }
  const prefix = COSMOS_PREFIX[chain];
  try {
    const account = fromBech32(wallet);
    const operator = fromBech32(validator ?? "");
    if (account.prefix === prefix && operator.prefix === `${prefix}valoper` &&
        account.data.length === 20 && operator.data.length === 20 &&
        wallet === wallet.toLowerCase() && validator === validator?.toLowerCase()) return null;
  } catch {
    // Invalid bech32, checksum, or missing validator.
  }
  return `${chain} staking requires a valid ${prefix} wallet and ${prefix}valoper validator`;
}
