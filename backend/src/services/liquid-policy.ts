export function liquidAmount(value: unknown): bigint {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,18}$/.test(value)) throw new Error("Amount must be positive integer base units");
  const amount = BigInt(value);
  if (amount > 10n ** 18n) throw new Error("Test route is limited to 1 token per transaction");
  return amount;
}
export function liquidTrackingMessage(wallet: string, issuedAt: number): string {
  return `CantonStake Amoy sPOL balance tracking\nWallet: ${wallet.toLowerCase()}\nChain: 80002\nIssued at: ${issuedAt}\nRecords public token balances on Canton. No token approval or CC reward entitlement.`;
}

/** Compare execution output with the pool's pre-trade spot, not a redemption guarantee. */
export function liquidPriceImpact(amount: bigint, output: bigint, sqrtPriceX96: bigint, spolIsToken0: boolean): number {
  if (sqrtPriceX96 <= 0n || amount <= 0n || output <= 0n) throw Error("Invalid swap quote");
  const square = sqrtPriceX96 * sqrtPriceX96;
  const spot = spolIsToken0 ? amount * square / (1n << 192n) : amount * (1n << 192n) / square;
  if (spot <= 0n) throw Error("Invalid pool price");
  const impact = output >= spot ? 0 : Number(((spot - output) * 10000n + spot - 1n) / spot);
  if (impact > 500) throw Error("Exit price impact exceeds 5%");
  return impact;
}
