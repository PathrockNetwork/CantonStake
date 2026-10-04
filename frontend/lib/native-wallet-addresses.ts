/** Preserve case-sensitive Solana/SS58 keys; normalize hex and bech32 only. */
export function normalizedNativeWallet(address: string): string {
  return /^(?:[1-9A-HJ-NP-Za-km-z]{32,44}|[1-9A-HJ-NP-Za-km-z]{47,49})$/.test(address)
    ? address : address.toLowerCase();
}

export function nativeWalletScope(addresses: string[]): string[] {
  return [...new Set(addresses.map(normalizedNativeWallet))].sort();
}
