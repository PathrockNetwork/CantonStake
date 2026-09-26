/** Do not sign an intent or exit with an account different from its owner. */
export function assertWalletOwner(
  chain: string,
  currentAddress: string | null | undefined,
  expectedAddress: string,
  caseInsensitive = false,
): void {
  const current = caseInsensitive ? currentAddress?.toLowerCase() : currentAddress;
  const expected = caseInsensitive ? expectedAddress.toLowerCase() : expectedAddress;
  if (!current || current !== expected) {
    throw new Error(`${chain} wallet account changed; reconnect the account that owns this Canton request or position before signing.`);
  }
}

/** Recheck the connected account and chain after async reads, switching, or
 * API calls. The send itself must also specify this same account/chain. */
export function assertEvmWalletBinding(
  current: { address?: string; chainId?: number },
  owner: string,
  targetChainId: number,
): void {
  assertWalletOwner("EVM", current.address, owner, true);
  if (current.chainId !== targetChainId) {
    throw new Error(`EVM wallet network changed; switch to chain ${targetChainId} before signing.`);
  }
}
