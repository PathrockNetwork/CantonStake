/** Solana public keys and Polkadot SS58 addresses are case-sensitive base58.
 * EVM/Move hex and bech32 addresses are normalized to lower case in the
 * existing Canton mirror. */
export function normalizeWalletAddress(address: string): string {
  return /^(?:[1-9A-HJ-NP-Za-km-z]{32,44}|[1-9A-HJ-NP-Za-km-z]{47,49})$/.test(address)
    ? address
    : address.toLowerCase();
}

export function sameWalletAddress(left: string | undefined, right: string): boolean {
  return left !== undefined && normalizeWalletAddress(left) === normalizeWalletAddress(right);
}
